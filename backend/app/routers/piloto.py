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
    TODO: equipo/hoy guardan el texto visible del dropdown; cambiar a códigos
    estables + CHECK antes de aplicar la migración en Azure.
    """

    nombre: Annotated[Texto, Field(max_length=100)]
    email: Annotated[Texto, Field(max_length=254, pattern=r"^\S+@\S+\.\S+$")]
    empresa: Annotated[Texto, Field(max_length=150)]
    equipo: Literal["Solo yo", "2 a 5", "6 a 10", "11 a 20", "Más de 20"]
    hoy: Literal["Excel o Google Sheets", "WhatsApp y fotos", "Papel y boletas sueltas", "Otro sistema"]


@router.post("", status_code=status.HTTP_201_CREATED)
def registrar_interesado(datos: InteresadoPiloto, db: Session = Depends(get_db)):
    """
    Endpoint público (sin get_current_user): lo llama la landing antes de que
    exista una cuenta. piloto_interesados no tiene empresa_id ni RLS.

    Un correo repetido responde igual que uno nuevo, para no revelar a
    terceros qué correos ya están registrados.
    """
    try:
        db.execute(
            text(
                """
                INSERT INTO piloto_interesados (nombre, email, empresa, equipo, gestion_hoy)
                VALUES (:nombre, :email, :empresa, :equipo, :hoy)
                """
            ),
            datos.model_dump(),
        )
        db.commit()
    except IntegrityError:
        db.rollback()  # uq_piloto_interesados_email: ya estaba registrado
    return {"ok": True}
