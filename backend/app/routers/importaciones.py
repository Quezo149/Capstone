"""
Importación masiva desde CSV/XLSX (HU10–HU13 — KONTADORIA-67, 69, 72, 74). Motor híbrido
(decisión del 09-11-2026, ver db/migrations/0014_importaciones_formatos.sql):

- El navegador lee la planilla, reconoce sus columnas, arma la vista previa y el archivo de filas
  con error. El archivo NO llega al servidor.
- Al confirmar, el navegador manda solo las filas interpretadas. Este router no confía en ellas:
  valida cada una con las mismas reglas que un movimiento manual (DatosMovimiento), revisa las
  categorías y que los conteos cuadren, y guarda la importación y sus movimientos en una
  transacción. Repetir el envío (mismo client_request_id) no duplica nada.

Los permisos los decide app/core/permisos.py (admin y contador) y RLS aísla por empresa.
"""

import datetime as dt
import json
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, require_permiso
from app.core.db import get_db
from app.routers.expenses import DatosMovimiento

router = APIRouter()

# Mismo límite que el motor del navegador (Prototipo/fuente/src/lib/importacion.js, MAX_FILAS)
MAX_FILAS = 2000
# El mapeo de un formato es un JSON chico (qué columna es qué); el tope evita guardar basura
MAX_MAPEO = 8000
MAX_ALIAS = 300

Texto = Annotated[str, StringConstraints(strip_whitespace=True)]


def _error(status_code: int, codigo: str, mensaje: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"codigo": codigo, "mensaje": mensaje, **extra})


class FilaImportada(DatosMovimiento):
    """Una fila válida de la planilla, ya interpretada por el navegador."""

    n: Annotated[int, Field(ge=1, le=1_048_576)]  # n.º de fila en Excel (máximo de filas de una hoja)
    # tipo|fecha|monto|descripción normalizada|ocurrencia (ver 0014)
    huella: Annotated[str, StringConstraints(min_length=1, max_length=700)]

    @model_validator(mode="after")
    def _huella_coincide(self):
        # La huella empieza con los mismos datos que se guardan: una huella inventada no puede
        # marcar como "ya importada" una fila distinta
        if not self.huella.startswith(f"{self.tipo}|{self.fecha.isoformat()}|{self.monto}|"):
            raise ValueError("La huella de la fila no corresponde a sus datos.")
        return self


class Formato(BaseModel):
    """Formato de una planilla propia. Sin formato = la plantilla de KontadorIA."""

    id: uuid.UUID | None = None  # el formato que se reconoció (se actualiza)
    guardar: bool = False  # "Recordar este formato"
    nombre: Annotated[Texto, Field(min_length=1, max_length=80)] | None = None
    huella: Annotated[str, StringConstraints(min_length=1, max_length=900)]
    mapeo: dict

    @field_validator("mapeo")
    @classmethod
    def _mapeo_chico(cls, v: dict) -> dict:
        if len(json.dumps(v, ensure_ascii=False)) > MAX_MAPEO:
            raise ValueError("El formato es demasiado grande.")
        return v


class NuevaImportacion(BaseModel):
    client_request_id: uuid.UUID | None = None
    nombre_archivo: Annotated[Texto, Field(min_length=1, max_length=255)]
    tipo_archivo: Literal["csv", "xlsx"]
    archivo_sha256: Annotated[str, StringConstraints(to_lower=True, pattern=r"^[0-9a-fA-F]{64}$")] | None = None
    # Conteos de la revisión: total = filas enviadas + con error + excluidas (duplicados o quitadas)
    total_filas: Annotated[int, Field(ge=1, le=MAX_FILAS)]
    filas_con_error: Annotated[int, Field(ge=0, le=MAX_FILAS)] = 0
    filas_omitidas: Annotated[int, Field(ge=0, le=1_048_576)] = 0  # totales, saldos, títulos, ocultas
    filas: Annotated[list[FilaImportada], Field(min_length=1, max_length=MAX_FILAS)]
    formato: Formato | None = None
    # Categorías de la planilla asociadas en la revisión: {"bencina": <id de Transporte>}
    alias: Annotated[dict[Annotated[str, StringConstraints(min_length=1, max_length=150)], uuid.UUID], Field(max_length=MAX_ALIAS)] = {}

    @model_validator(mode="after")
    def _conteos_cuadran(self):
        if len(self.filas) + self.filas_con_error > self.total_filas:
            raise ValueError("Los conteos de la importación no cuadran.")
        if len({f.huella for f in self.filas}) != len(self.filas):
            raise ValueError("Hay filas repetidas en el envío.")
        return self


# ---------------------------------------------------------------------------------------------
# Lecturas
# ---------------------------------------------------------------------------------------------

_SELECT = """
    SELECT i.id, i.client_request_id, i.nombre_archivo, i.tipo_archivo, i.archivo_sha256, i.formato,
           i.total_filas, i.filas_importadas, i.filas_con_error, i.filas_excluidas, i.filas_omitidas,
           i.estado, i.creado_en, i.anulada_en, i.usuario_id,
           COALESCE(u.nombre, u.email) AS usuario_nombre,
           COALESCE(a.nombre, a.email) AS anulada_por_nombre
    FROM dbo.importaciones i
    JOIN dbo.usuarios u ON u.id = i.usuario_id
    LEFT JOIN dbo.usuarios a ON a.id = i.anulada_por
"""


def _leer(db: Session, importacion_id) -> dict | None:
    row = db.execute(
        text(f"{_SELECT} WHERE i.id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"), {"id": str(importacion_id)}
    ).mappings().first()
    return dict(row) if row else None


def _por_client_request_id(db: Session, crid: str) -> dict | None:
    imp_id = db.execute(text("SELECT id FROM dbo.importaciones WHERE client_request_id = :crid"), {"crid": crid}).scalar()
    return _leer(db, imp_id) if imp_id else None


def _no_encontrada() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "no_encontrada", "Importación no encontrada.")


@router.get("")
def listar_importaciones(
    user: CurrentUser = Depends(require_permiso("importaciones.ver")),
    db: Session = Depends(get_db),
):
    """HU13 — KONTADORIA-75. Historial de la empresa (RLS), de la más reciente a la más antigua."""
    rows = db.execute(text(f"{_SELECT} ORDER BY i.creado_en DESC OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY")).mappings().all()
    return [dict(r) for r in rows]


@router.get("/formatos")
def listar_formatos(
    user: CurrentUser = Depends(require_permiso("importaciones.realizar")),
    db: Session = Depends(get_db),
):
    """Formatos recordados de la empresa: el navegador los usa para reconocer una planilla propia."""
    rows = db.execute(
        text(
            """
            SELECT f.id, f.nombre, f.huella, f.mapeo, f.usos, f.creado_en, f.usado_en,
                   COALESCE(u.nombre, u.email) AS creado_por
            FROM dbo.importacion_formatos f JOIN dbo.usuarios u ON u.id = f.creado_por
            ORDER BY f.usado_en DESC
            """
        )
    ).mappings().all()
    return [{**dict(r), "mapeo": json.loads(r["mapeo"])} for r in rows]


@router.delete("/formatos/{formato_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_formato(
    formato_id: str,
    user: CurrentUser = Depends(require_permiso("importaciones.realizar")),
    db: Session = Depends(get_db),
):
    """Olvidar un formato. Las importaciones hechas con él no cambian (guardan su nombre)."""
    borrados = db.execute(
        text("DELETE FROM dbo.importacion_formatos WHERE id = TRY_CAST(:id AS UNIQUEIDENTIFIER)"), {"id": formato_id}
    ).rowcount
    db.commit()
    if not borrados:
        raise _error(status.HTTP_404_NOT_FOUND, "no_encontrado", "Formato no encontrado.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/alias")
def listar_alias(
    user: CurrentUser = Depends(require_permiso("importaciones.realizar")),
    db: Session = Depends(get_db),
):
    """Categorías de planilla ya asociadas: {"bencina": "<id de Transporte>"}."""
    rows = db.execute(text("SELECT valor, categoria_id FROM dbo.categorias_alias")).all()
    return {r.valor: str(r.categoria_id) for r in rows}


# ---------------------------------------------------------------------------------------------
# Confirmar (HU12 — KONTADORIA-72, HU13 — KONTADORIA-74)
# ---------------------------------------------------------------------------------------------


def _categorias_visibles(db: Session) -> dict[str, tuple[str, bool]]:
    """{id: (tipo, oculta)} de las categorías que la empresa ve (predefinidas + propias, RLS)."""
    rows = db.execute(
        text(
            """
            SELECT c.id, c.tipo,
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.categorias_ocultas o WHERE o.categoria_id = c.id)
                        THEN 1 ELSE 0 END AS oculta
            FROM dbo.categorias c
            """
        )
    ).all()
    return {str(r.id).lower(): (r.tipo, bool(r.oculta)) for r in rows}


def _validar_categorias(db: Session, datos: NuevaImportacion) -> None:
    """Cada fila con una categoría visible, no oculta y de su mismo tipo; lo mismo los alias."""
    visibles = _categorias_visibles(db)
    malas = []
    for f in datos.filas:
        cat = visibles.get(str(f.categoria_id).lower())
        if not cat or cat[1]:
            malas.append({"n": f.n, "motivo": "La categoría no existe o está oculta."})
        elif cat[0] != f.tipo:
            malas.append({"n": f.n, "motivo": "La categoría no corresponde al tipo del movimiento."})
    if malas:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "filas_invalidas",
            "Algunas filas cambiaron desde la revisión. Vuelve a revisar la planilla.", filas=malas[:50],
        )
    for valor, cat_id in datos.alias.items():
        cat = visibles.get(str(cat_id).lower())
        if not cat or cat[1]:
            raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "alias_invalido", f"La categoría asociada a «{valor}» no existe.")


def _guardar_formato(db: Session, user: CurrentUser, formato: Formato) -> str:
    """Actualiza el formato reconocido o recuerda uno nuevo. Devuelve el nombre para el historial."""
    mapeo = json.dumps(formato.mapeo, ensure_ascii=False)
    existente = None
    if formato.id:
        existente = db.execute(
            text("SELECT id, nombre FROM dbo.importacion_formatos WHERE id = :id"), {"id": str(formato.id)}
        ).first()
        if not existente:
            raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "formato_no_encontrado", "Ese formato ya no existe. Vuelve a subir la planilla.")
    elif formato.guardar:
        # Mismo encabezado que uno ya recordado: se actualiza ese, no se duplica
        existente = db.execute(
            text("SELECT id, nombre FROM dbo.importacion_formatos WHERE huella = :huella"), {"huella": formato.huella}
        ).first()

    nombre = formato.nombre if formato.guardar and formato.nombre else None
    if existente:
        db.execute(
            text(
                """
                UPDATE dbo.importacion_formatos
                SET huella = :huella, mapeo = :mapeo, usos = usos + 1, usado_en = SYSUTCDATETIME(),
                    nombre = COALESCE(:nombre, nombre)
                WHERE id = :id
                """
            ),
            {"huella": formato.huella, "mapeo": mapeo, "nombre": nombre, "id": str(existente.id)},
        )
        return nombre or existente.nombre
    if formato.guardar:
        db.execute(
            text(
                """
                INSERT INTO dbo.importacion_formatos (empresa_id, nombre, huella, mapeo, creado_por)
                VALUES (:empresa_id, :nombre, :huella, :mapeo, :usuario_id)
                """
            ),
            {"empresa_id": user.empresa_id, "nombre": nombre or "Mi planilla", "huella": formato.huella,
             "mapeo": mapeo, "usuario_id": user.usuario_id},
        )
        return nombre or "Mi planilla"
    return "Planilla propia"


def _guardar_alias(db: Session, user: CurrentUser, alias: dict[str, uuid.UUID]) -> None:
    for valor, cat_id in alias.items():
        db.execute(
            text(
                """
                MERGE dbo.categorias_alias AS d
                USING (SELECT :empresa_id AS empresa_id, :valor AS valor) AS o
                   ON d.empresa_id = o.empresa_id AND d.valor = o.valor
                WHEN MATCHED THEN UPDATE SET categoria_id = :categoria_id, actualizado_por = :usuario_id,
                                             actualizado_en = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (empresa_id, valor, categoria_id, actualizado_por)
                                      VALUES (:empresa_id, :valor, :categoria_id, :usuario_id);
                """
            ),
            {"empresa_id": user.empresa_id, "valor": valor, "categoria_id": str(cat_id), "usuario_id": user.usuario_id},
        )


@router.post("", status_code=status.HTTP_201_CREATED)
def confirmar_importacion(
    datos: NuevaImportacion,
    user: CurrentUser = Depends(require_permiso("importaciones.realizar")),
    db: Session = Depends(get_db),
):
    """
    Guarda en UNA transacción la importación, sus movimientos (origen 'importacion_masiva', a
    nombre de quien importa), el formato (si se pidió recordarlo) y las categorías asociadas.
    Si algo falla no queda nada. La empresa y el usuario salen del token, nunca del body.
    """
    crid = str(datos.client_request_id) if datos.client_request_id else None
    if crid and (previa := _por_client_request_id(db, crid)):
        return previa

    _validar_categorias(db, datos)

    importadas = len(datos.filas)
    try:
        formato = _guardar_formato(db, user, datos.formato) if datos.formato else "Plantilla KontadorIA"
        _guardar_alias(db, user, datos.alias)
        imp_id = db.execute(
            text(
                """
                INSERT INTO dbo.importaciones (empresa_id, usuario_id, client_request_id, nombre_archivo, tipo_archivo,
                                               archivo_sha256, formato, total_filas, filas_importadas, filas_con_error,
                                               filas_excluidas, filas_omitidas, estado)
                OUTPUT inserted.id
                VALUES (:empresa_id, :usuario_id, :crid, :nombre_archivo, :tipo_archivo, :sha, :formato, :total,
                        :importadas, :con_error, :excluidas, :omitidas, :estado)
                """
            ),
            {
                "empresa_id": user.empresa_id,
                "usuario_id": user.usuario_id,
                "crid": crid,
                "nombre_archivo": datos.nombre_archivo,
                "tipo_archivo": datos.tipo_archivo,
                "sha": datos.archivo_sha256,
                "formato": formato,
                "total": datos.total_filas,
                "importadas": importadas,
                "con_error": datos.filas_con_error,
                "excluidas": datos.total_filas - importadas - datos.filas_con_error,
                "omitidas": datos.filas_omitidas,
                "estado": "completada_con_errores" if datos.filas_con_error else "completada",
            },
        ).scalar_one()
        db.execute(
            text(
                """
                INSERT INTO dbo.movimientos (empresa_id, usuario_id, categoria_id, importacion_id, tipo, fecha, monto,
                                             proveedor, descripcion, tipo_documento, origen, huella_importacion, fila_origen)
                VALUES (:empresa_id, :usuario_id, :categoria_id, :importacion_id, :tipo, :fecha, :monto,
                        :proveedor, :descripcion, :tipo_documento, 'importacion_masiva', :huella, :n)
                """
            ),
            [
                {
                    "empresa_id": user.empresa_id,
                    "usuario_id": user.usuario_id,
                    "categoria_id": str(f.categoria_id),
                    "importacion_id": str(imp_id),
                    "tipo": f.tipo,
                    "fecha": f.fecha,
                    "monto": f.monto,
                    "proveedor": f.proveedor,
                    "descripcion": f.descripcion,
                    "tipo_documento": f.tipo_documento,
                    "huella": f.huella,
                    "n": f.n,
                }
                for f in datos.filas
            ],
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Doble clic en "Importar": el otro envío ya la guardó
        if crid and "uq_importaciones_client_request_id" in str(exc.orig) and (previa := _por_client_request_id(db, crid)):
            return previa
        raise
    return _leer(db, imp_id)


# ---------------------------------------------------------------------------------------------
# Anular y restaurar una importación completa
# ---------------------------------------------------------------------------------------------


@router.post("/{importacion_id}/anular")
def anular_importacion(
    importacion_id: str,
    user: CurrentUser = Depends(require_permiso("importaciones.anular")),
    db: Session = Depends(get_db),
):
    """
    Anula todos los movimientos vigentes de la importación con la MISMA marca de tiempo que queda
    en la importación: así restaurar devuelve exactamente esos, y no los que alguien ya había
    anulado uno por uno antes.
    """
    imp = _leer(db, importacion_id)
    if not imp:
        raise _no_encontrada()
    if imp["anulada_en"]:
        raise _error(status.HTTP_409_CONFLICT, "ya_anulada", "Esta importación ya está anulada.")
    ahora = dt.datetime.now(dt.UTC).replace(tzinfo=None)
    db.execute(
        text(
            """
            UPDATE dbo.movimientos SET eliminado_en = :ahora, eliminado_por = :usuario_id
            WHERE importacion_id = :id AND eliminado_en IS NULL
            """
        ),
        {"ahora": ahora, "usuario_id": user.usuario_id, "id": str(imp["id"])},
    )
    db.execute(
        text("UPDATE dbo.importaciones SET anulada_en = :ahora, anulada_por = :usuario_id WHERE id = :id AND anulada_en IS NULL"),
        {"ahora": ahora, "usuario_id": user.usuario_id, "id": str(imp["id"])},
    )
    db.commit()
    return _leer(db, imp["id"])


@router.post("/{importacion_id}/restaurar")
def restaurar_importacion(
    importacion_id: str,
    user: CurrentUser = Depends(require_permiso("importaciones.anular")),
    db: Session = Depends(get_db),
):
    """
    "Deshacer" de la anulación. Si después de anularla se volvió a importar el mismo archivo (o un
    período que se solapa), restaurarla duplicaría esos movimientos: entonces responde 409.
    """
    imp = _leer(db, importacion_id)
    if not imp:
        raise _no_encontrada()
    if not imp["anulada_en"]:
        raise _error(status.HTTP_409_CONFLICT, "no_anulada", "Esta importación no está anulada.")
    params = {"id": str(imp["id"]), "anulada_en": imp["anulada_en"]}
    repetidas = db.execute(
        text(
            """
            SELECT COUNT(*) FROM dbo.movimientos m
            WHERE m.importacion_id = :id AND m.eliminado_en = :anulada_en
              AND EXISTS (SELECT 1 FROM dbo.movimientos o
                          WHERE o.huella_importacion = m.huella_importacion AND o.eliminado_en IS NULL)
            """
        ),
        params,
    ).scalar()
    if repetidas:
        raise _error(
            status.HTTP_409_CONFLICT, "ya_reimportada",
            f"{repetidas} {'movimiento ya está' if repetidas == 1 else 'movimientos ya están'} de nuevo en otra importación. "
            "Restaurarla los duplicaría.",
        )
    db.execute(
        text(
            """
            UPDATE dbo.movimientos SET eliminado_en = NULL, eliminado_por = NULL
            WHERE importacion_id = :id AND eliminado_en = :anulada_en
            """
        ),
        params,
    )
    db.execute(text("UPDATE dbo.importaciones SET anulada_en = NULL, anulada_por = NULL WHERE id = :id"), params)
    db.commit()
    return _leer(db, imp["id"])
