from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db

router = APIRouter()

# Mismos largos que las columnas de 0001_piloto_interesados.sql.
Texto = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class InteresadoPiloto(BaseModel):
    """
    Cuerpo que envía el formulario de la landing (landing/src/components/SignupForm.jsx).
    equipo/hoy son códigos estables; deben coincidir con los CHECK de la tabla.
    """

    nombre: Annotated[Texto, Field(max_length=100)]
    email: Annotated[Texto, Field(max_length=254, pattern=r"^\S+@\S+\.\S+$")]
    empresa: Annotated[Texto, Field(max_length=150)]
    equipo: Literal["1", "2-5", "6-10", "11-20", "21+"]
    hoy: Literal["excel", "whatsapp", "papel", "otro"]
    # Honeypot: campo oculto en la landing. Una persona lo deja vacío; un bot lo llena.
    sitio_web: Annotated[str, Field(max_length=200)] = ""


@router.post("", status_code=status.HTTP_201_CREATED)
def registrar_interesado(datos: InteresadoPiloto, db: Session = Depends(get_db)):
    """
    Endpoint público (sin get_current_user): lo llama la landing antes de que
    exista una cuenta. piloto_interesados no tiene empresa_id ni RLS.

    Un correo repetido responde igual que uno nuevo, para no revelar a
    terceros qué correos ya están registrados.

    Si el honeypot viene lleno, se responde el mismo 201 sin guardar nada,
    para que el bot crea que tuvo éxito y no pruebe otra estrategia.
    """
    if datos.sitio_web:
        return {"ok": True}
    try:
        db.execute(
            text(
                """
                INSERT INTO piloto_interesados (nombre, email, empresa, equipo, gestion_hoy)
                VALUES (:nombre, :email, :empresa, :equipo, :hoy)
                """
            ),
            datos.model_dump(exclude={"sitio_web"}),
        )
        db.commit()
    except IntegrityError:
        db.rollback()  # uq_piloto_interesados_email: ya estaba registrado
    return {"ok": True}
