import datetime as dt
import logging
import uuid
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from azure.core.exceptions import AzureError, ResourceNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import almacenamiento
from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db
from app.core.permisos import PERMISOS
from app.core.rut import normalizar_rut
from app.core.sugerencias import buscar_duplicado

router = APIRouter()
log = logging.getLogger(__name__)

Texto = Annotated[str, StringConstraints(strip_whitespace=True)]


class DatosMovimiento(BaseModel):
    """Mismos límites que dbo.movimientos (db/migrations/0006_movimientos.sql)."""

    tipo: Literal["ingreso", "gasto"]
    fecha: dt.date
    # Pesos chilenos, entero (BIGINT). El tope evita montos absurdos por un cero de más.
    monto: Annotated[int, Field(gt=0, le=999_999_999_999)]
    categoria_id: uuid.UUID
    proveedor: Annotated[Texto, Field(max_length=150)] | None = None
    descripcion: Annotated[Texto, Field(max_length=500)] | None = None
    tipo_documento: Literal["boleta", "factura", "otro"]
    # RUT del emisor (0010): lo propone la lectura con IA y el usuario lo confirma o corrige
    proveedor_rut: str | None = None

    @field_validator("fecha")
    @classmethod
    def _fecha_razonable(cls, v: dt.date) -> dt.date:
        if v.year < 2000:
            raise ValueError("Revisa la fecha.")
        return v

    @field_validator("proveedor", "descripcion")
    @classmethod
    def _vacio_es_nulo(cls, v: str | None) -> str | None:
        return v or None

    @field_validator("proveedor_rut")
    @classmethod
    def _rut_normalizado(cls, v: str | None) -> str | None:
        return normalizar_rut(v) if v and v.strip() else None  # ValueError → 422 con el motivo


class NuevoMovimiento(DatosMovimiento):
    # Lo genera la app al abrir el formulario: el mismo envío repetido (doble clic,
    # reintento con mala conexión) se guarda una sola vez.
    client_request_id: uuid.UUID | None = None
    # HU09 — KONTADORIA-61: el archivo que devolvió POST /documentos/extraer. Con él, el origen
    # pasa a "foto" o "pdf" y el comprobante queda guardado junto al movimiento.
    archivo_id: str | None = None
    # El usuario ya vio el aviso de compra repetida y eligió "Guardar igual"
    aceptar_duplicado: bool = False

    @field_validator("archivo_id")
    @classmethod
    def _archivo_valido(cls, v: str | None) -> str | None:
        if v and not almacenamiento.es_archivo_id(v):
            raise ValueError("El archivo no es válido.")
        return v or None


def _error(status_code: int, codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje})


# Quién lo registró se muestra en el listado y alimenta el filtro por usuario (HU07).
_SELECT = """
    SELECT m.id, m.empresa_id, m.usuario_id, m.categoria_id, m.tipo, m.fecha, m.monto, m.proveedor,
           m.descripcion, m.tipo_documento, m.origen, m.client_request_id, m.creado_en, m.proveedor_rut,
           CAST(CASE WHEN m.archivo_blob IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_comprobante,
           COALESCE(u.nombre, u.email) AS usuario_nombre
    FROM dbo.movimientos m
    JOIN dbo.usuarios u ON u.id = m.usuario_id
"""


# Vigente = no anulado (0008_movimientos_anulacion.sql). Toda lectura parte de aquí.
_VIGENTE = "m.eliminado_en IS NULL"


def _leer(db: Session, movimiento_id, anulados: bool = False) -> dict | None:
    filtro = "" if anulados else f" AND {_VIGENTE}"
    row = db.execute(
        text(f"{_SELECT} WHERE m.id = TRY_CAST(:id AS UNIQUEIDENTIFIER){filtro}"), {"id": str(movimiento_id)}
    ).mappings().first()
    return dict(row) if row else None


def _no_encontrado() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "no_encontrado", "Movimiento no encontrado.")


def _validar_categoria(db: Session, datos: DatosMovimiento) -> None:
    """La categoría debe ser visible para la empresa (predefinida o propia, RLS) y del mismo tipo."""
    tipo = db.execute(
        text("SELECT tipo FROM dbo.categorias WHERE id = :id"), {"id": str(datos.categoria_id)}
    ).scalar()
    if tipo != datos.tipo:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "categoria_invalida", "Elige una categoría del tipo correspondiente.")


@router.get("")
def listar_movimientos(
    tipo: Literal["ingreso", "gasto"] | None = None,
    categoria_id: uuid.UUID | None = None,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
    usuario_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require_permiso("movimientos.ver")),
    db: Session = Depends(get_db),
):
    """
    HU07 — KONTADORIA-51. No filtra manualmente por empresa_id/usuario_id en el WHERE — esa
    responsabilidad es de las políticas de RLS de Azure SQL, ya activadas sobre este `db` por
    get_current_user() vía SESSION_CONTEXT. Los filtros solo acotan dentro de lo permitido.
    """
    if usuario_id is not None and user.rol not in PERMISOS["movimientos.filtrar_usuario"]:
        # RLS igual no le mostraría movimientos ajenos, pero el filtro no es para su rol.
        raise _error(status.HTTP_403_FORBIDDEN, "rol_sin_permiso", "Tu rol no puede filtrar por usuario.")

    condiciones, params = [_VIGENTE], {}
    for campo, valor, sql in (
        ("tipo", tipo, "m.tipo = :tipo"),
        ("categoria_id", categoria_id, "m.categoria_id = :categoria_id"),
        ("desde", desde, "m.fecha >= :desde"),
        ("hasta", hasta, "m.fecha <= :hasta"),
        ("usuario_id", usuario_id, "m.usuario_id = :usuario_id"),
    ):
        if valor is not None:
            condiciones.append(sql)
            params[campo] = str(valor) if isinstance(valor, uuid.UUID) else valor
    rows = db.execute(text(f"{_SELECT} WHERE {' AND '.join(condiciones)} ORDER BY m.fecha DESC, m.creado_en DESC"), params).mappings().all()
    return [dict(r) for r in rows]


# ---------- Resumen mensual (HU18 — KONTADORIA-62) ----------

# Los meses se cuentan en hora de Chile: en Azure el servidor está en UTC y a las 22:00 del 31
# ya sería "el mes siguiente"
_ZONA = ZoneInfo("America/Santiago")


def _hoy() -> dt.date:
    return dt.datetime.now(_ZONA).date()


def _primer_dia(mes: str) -> dt.date:
    return dt.date(int(mes[:4]), int(mes[5:7]), 1)


def _sumar_mes(dia: dt.date, n: int) -> dt.date:
    """Primer día del mes `n` meses después (o antes) del de `dia`."""
    total = dia.year * 12 + dia.month - 1 + n
    return dt.date(total // 12, total % 12 + 1, 1)


def _totales(db: Session, desde: dt.date, hasta: dt.date) -> dict:
    """Ingresos y gastos vigentes con fecha en [desde, hasta)."""
    filas = db.execute(
        text(
            f"""
            SELECT m.tipo, SUM(m.monto) AS total FROM dbo.movimientos m
            WHERE {_VIGENTE} AND m.fecha >= :desde AND m.fecha < :hasta
            GROUP BY m.tipo
            """
        ),
        {"desde": desde, "hasta": hasta},
    ).all()
    t = {tipo: int(total) for tipo, total in filas}
    ingresos, gastos = t.get("ingreso", 0), t.get("gasto", 0)
    return {"ingresos": ingresos, "gastos": gastos, "saldo": ingresos - gastos}


@router.get("/resumen")
def resumen_mensual(
    mes: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    user: CurrentUser = Depends(require_permiso("movimientos.ver")),
    db: Session = Depends(get_db),
):
    """
    Dashboard del mes (`mes` = AAAA-MM; por defecto el actual): ingresos, gastos, saldo, gastos por
    categoría y últimos movimientos, más el mes anterior para comparar. Qué movimientos cuentan lo
    decide RLS, como en el listado: el empleado ve el resumen de lo suyo (KONTADORIA-64).

    Comparación: en el mes en curso, contra el mismo tramo del mes anterior (del 1 al día de hoy),
    porque a mitad de mes la comparación con un mes completo siempre parecería una caída. Un mes
    cerrado se compara con el anterior completo.
    """
    hoy = _hoy()
    desde = _primer_dia(mes) if mes else hoy.replace(day=1)
    hasta = _sumar_mes(desde, 1)
    en_curso = desde <= hoy < hasta
    desde_ant = _sumar_mes(desde, -1)
    hasta_ant = min(desde_ant + dt.timedelta(days=hoy.day), desde) if en_curso else desde

    por_categoria = db.execute(
        text(
            f"""
            SELECT c.id AS categoria_id, c.nombre, c.color, SUM(m.monto) AS monto, COUNT(*) AS cantidad
            FROM dbo.movimientos m JOIN dbo.categorias c ON c.id = m.categoria_id
            WHERE {_VIGENTE} AND m.tipo = 'gasto' AND m.fecha >= :desde AND m.fecha < :hasta
            GROUP BY c.id, c.nombre, c.color
            ORDER BY SUM(m.monto) DESC, c.nombre
            """
        ),
        {"desde": desde, "hasta": hasta},
    ).mappings().all()
    ultimos = db.execute(
        text(
            f"""
            {_SELECT} WHERE {_VIGENTE} AND m.fecha >= :desde AND m.fecha < :hasta
            ORDER BY m.fecha DESC, m.creado_en DESC OFFSET 0 ROWS FETCH NEXT 6 ROWS ONLY
            """
        ),
        {"desde": desde, "hasta": hasta},
    ).mappings().all()
    primero = db.execute(text(f"SELECT MIN(m.fecha) FROM dbo.movimientos m WHERE {_VIGENTE}")).scalar()

    return {
        "mes": f"{desde:%Y-%m}",
        "en_curso": en_curso,
        **_totales(db, desde, hasta),
        "anterior": {
            "mes": f"{desde_ant:%Y-%m}",
            # Último día que entra en la comparación (en curso: el mismo día del mes de hoy)
            "hasta": (hasta_ant - dt.timedelta(days=1)).isoformat(),
            **_totales(db, desde_ant, hasta_ant),
        },
        "por_categoria": [{**c, "categoria_id": str(c["categoria_id"]), "monto": int(c["monto"])} for c in por_categoria],
        "ultimos": [dict(m) for m in ultimos],
        "primer_mes": f"{primero:%Y-%m}" if primero else None,
    }


# Extensiones que acepta POST /documentos/extraer (app/core/ia.py)
_TIPOS_COMPROBANTE = {"jpg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}


@router.get("/{movimiento_id}/comprobante")
def ver_comprobante(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.ver")),
    db: Session = Depends(get_db),
):
    """
    HU09 — la foto o el PDF guardado con un movimiento, como link temporal de solo lectura
    (almacenamiento.url_lectura). Lo ven los mismos que ven el movimiento: RLS, como en
    GET /movimientos/{id} (otra empresa u otro empleado → 404). El contador también: revisa.
    """
    fila = db.execute(
        text(
            f"""
            SELECT m.archivo_blob, m.origen FROM dbo.movimientos m
            WHERE m.id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND {_VIGENTE}
            """
        ),
        {"id": movimiento_id},
    ).first()
    if fila is None:
        raise _no_encontrado()
    if not fila.archivo_blob:
        raise _error(status.HTTP_404_NOT_FOUND, "sin_comprobante", "Este movimiento no tiene un documento guardado.")
    return {
        "url": almacenamiento.url_lectura(fila.archivo_blob),
        "origen": fila.origen,
        "tipo": _TIPOS_COMPROBANTE[fila.archivo_blob.rsplit(".", 1)[-1]],
        "vence_en_minutos": almacenamiento.MINUTOS_LINK,
    }


@router.get("/{movimiento_id}")
def ver_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.ver")),
    db: Session = Depends(get_db),
):
    """
    Un movimiento de otra empresa (o de otro empleado, si el rol es empleado) responde
    404 igual que uno inexistente: RLS lo oculta y así no se revela que existe (HU05).
    """
    mov = _leer(db, movimiento_id)
    if mov is None:
        raise _no_encontrado()
    return mov


@router.post("", status_code=status.HTTP_201_CREATED)
def crear_movimiento(
    datos: NuevoMovimiento,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    HU06 — KONTADORIA-48. La empresa y el usuario salen del token, nunca del body; el contador
    recibe 403 (decisión D1).
    HU09 — KONTADORIA-61. Con `archivo_id` (foto o PDF leído con IA) el comprobante se copia de
    pendientes/ a su carpeta definitiva ANTES de guardar: si la copia falla no se guarda nada, y
    si el guardado falla se borra la copia. El pendiente se borra al final (si eso falla, lo
    limpia la regla de ciclo de vida).
    """
    crid = str(datos.client_request_id) if datos.client_request_id else None
    if crid:
        repetido = db.execute(
            text("SELECT id FROM dbo.movimientos WHERE client_request_id = :crid"), {"crid": crid}
        ).scalar()
        if repetido:
            # anulados=True: si ese mismo envío se guardó y después se anuló, se devuelve tal cual
            return _leer(db, repetido, anulados=True)

    _validar_categoria(db, datos)

    # Con un documento cargado, se revisa de nuevo con los datos FINALES: la lectura pudo no traer
    # la fecha (el formulario pone la de hoy) o el usuario corrigió el monto. El registro manual
    # no se bloquea: dos compras iguales el mismo día son normales a mano.
    if datos.archivo_id and datos.tipo == "gasto" and not datos.aceptar_duplicado:
        previo = buscar_duplicado(
            db,
            {"monto": datos.monto, "fecha": datos.fecha.isoformat(), "proveedor": datos.proveedor, "proveedor_rut": datos.proveedor_rut},
        )
        if previo:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "posible_duplicado",
                    "mensaje": "Ya hay un gasto igual registrado. Revisa si es la misma compra.",
                    "duplicado": previo,
                },
            )

    origen, ruta = "manual", None
    if datos.archivo_id:
        origen = "pdf" if datos.archivo_id.endswith(".pdf") else "foto"
        try:
            # La empresa de la ruta sale del token: un archivo_id de otra empresa no se encuentra
            ruta = almacenamiento.confirmar(user.empresa_id, datos.archivo_id, datos.fecha)
        except ResourceNotFoundError:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "archivo_no_encontrado",
                "El archivo ya no está disponible. Vuelve a subir la foto o el PDF.",
            )
        except AzureError:
            log.exception("No se pudo guardar el comprobante en su carpeta definitiva")
            raise _error(
                status.HTTP_503_SERVICE_UNAVAILABLE, "almacenamiento_no_disponible",
                "No pudimos guardar el archivo. Inténtalo de nuevo en un momento.",
            )

    try:
        mov_id = db.execute(
            text(
                """
                INSERT INTO dbo.movimientos (empresa_id, usuario_id, categoria_id, client_request_id, tipo, fecha,
                                             monto, proveedor, proveedor_rut, descripcion, tipo_documento,
                                             origen, archivo_blob)
                OUTPUT inserted.id
                VALUES (:empresa_id, :usuario_id, :categoria_id, :crid, :tipo, :fecha,
                        :monto, :proveedor, :proveedor_rut, :descripcion, :tipo_documento,
                        :origen, :archivo_blob)
                """
            ),
            {
                **datos.model_dump(exclude={"client_request_id", "archivo_id", "aceptar_duplicado"}),
                "categoria_id": str(datos.categoria_id),
                "crid": crid,
                "origen": origen,
                "archivo_blob": ruta,
                "empresa_id": user.empresa_id,
                "usuario_id": user.usuario_id,
            },
        ).scalar_one()
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # El mismo envío llegó dos veces al mismo tiempo: el otro ya lo guardó (y su comprobante
        # es esta misma ruta, porque sale del mismo archivo_id y fecha: no se borra).
        if crid and "uq_movimientos_client_request_id" in str(exc.orig):
            repetido = db.execute(
                text("SELECT id FROM dbo.movimientos WHERE client_request_id = :crid"), {"crid": crid}
            ).scalar()
            if repetido:
                return _leer(db, repetido, anulados=True)
        _descartar_copia(ruta)
        raise
    except Exception:
        _descartar_copia(ruta)
        raise

    if datos.archivo_id:
        try:
            almacenamiento.borrar_pendiente(user.empresa_id, datos.archivo_id)
        except AzureError:
            log.warning("No se pudo borrar el pendiente %s; lo borrará la regla de ciclo de vida", datos.archivo_id)
    return _leer(db, mov_id)


def _descartar_copia(ruta: str | None) -> None:
    """El movimiento no se guardó: la copia definitiva del comprobante sobra (el pendiente sigue)."""
    if ruta:
        try:
            almacenamiento.borrar(ruta)
        except AzureError:
            log.exception("No se pudo borrar la copia %s de un movimiento que no se guardó", ruta)


@router.put("/{movimiento_id}")
def editar_movimiento(
    movimiento_id: str,
    datos: DatosMovimiento,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    Corrige un movimiento. El empleado solo alcanza los suyos (RLS → 404 con los ajenos);
    quién lo registró, el origen y la empresa no cambian.
    """
    if _leer(db, movimiento_id) is None:
        raise _no_encontrado()
    _validar_categoria(db, datos)
    db.execute(
        text(
            """
            UPDATE dbo.movimientos
            SET tipo = :tipo, fecha = :fecha, monto = :monto, categoria_id = :categoria_id,
                proveedor = :proveedor, descripcion = :descripcion,
                -- Si el cliente no manda el RUT (versiones anteriores de la app), se conserva
                proveedor_rut = CASE WHEN :rut_enviado = 1 THEN :proveedor_rut ELSE proveedor_rut END,
                tipo_documento = :tipo_documento
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND eliminado_en IS NULL
            """
        ),
        {
            **datos.model_dump(),
            "categoria_id": str(datos.categoria_id),
            "id": movimiento_id,
            "rut_enviado": int("proveedor_rut" in datos.model_fields_set),
        },
    )
    db.commit()
    return _leer(db, movimiento_id)


@router.delete("/{movimiento_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    Anula el movimiento (no lo borra): deja de contar en listados y totales, pero la fila queda
    con quién lo anuló y cuándo (0008_movimientos_anulacion.sql). Mismas reglas que editar:
    el empleado solo alcanza los suyos (RLS → 404 con los ajenos).
    """
    anulados = db.execute(
        text(
            """
            UPDATE dbo.movimientos SET eliminado_en = SYSUTCDATETIME(), eliminado_por = :usuario_id
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND eliminado_en IS NULL
            """
        ),
        {"id": movimiento_id, "usuario_id": user.usuario_id},
    ).rowcount
    db.commit()
    if not anulados:
        raise _no_encontrado()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{movimiento_id}/restaurar")
def restaurar_movimiento(
    movimiento_id: str,
    user: CurrentUser = Depends(require_permiso("movimientos.registrar")),
    db: Session = Depends(get_db),
):
    """
    "Deshacer" de la app: vuelve a dejar vigente un movimiento anulado, con su mismo id y fecha
    de creación. 404 si no existe, no está anulado o no es alcanzable para el rol (RLS).
    """
    restaurados = db.execute(
        text(
            """
            UPDATE dbo.movimientos SET eliminado_en = NULL, eliminado_por = NULL
            WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER) AND eliminado_en IS NOT NULL
            """
        ),
        {"id": movimiento_id},
    ).rowcount
    db.commit()
    if not restaurados:
        raise _no_encontrado()
    return _leer(db, movimiento_id)
