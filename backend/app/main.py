from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.db import es_transitorio, get_db
from app.routers import auth, categorias, documentos, empresas, expenses, invitaciones, piloto, usuarios

app = FastAPI(title="KontadorIA API")

# En Azure, el dominio real de Netlify reemplaza el localhost de desarrollo.
# TODO: mover esta lista a Settings (app.core.config) para no hardcodearla.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # frontend (app)
        "http://localhost:5173",
        "https://kontadoria.netlify.app",
        "https://app.kontadoria.cl",
        # landing (formulario del piloto)
        "http://localhost:5174",
        "https://landing-kontadoria.netlify.app",
        "https://kontadoria.cl",
        "https://www.kontadoria.cl",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(empresas.router, prefix="/empresas", tags=["empresas"])
app.include_router(categorias.router, prefix="/categorias", tags=["categorias"])
app.include_router(expenses.router, prefix="/movimientos", tags=["movimientos"])
app.include_router(documentos.router, prefix="/documentos", tags=["documentos"])
app.include_router(usuarios.router, prefix="/usuarios", tags=["usuarios"])
app.include_router(invitaciones.router, prefix="/invitaciones", tags=["invitaciones"])
app.include_router(piloto.router, prefix="/piloto", tags=["piloto"])


@app.exception_handler(DBAPIError)
async def base_no_disponible(request: Request, exc: DBAPIError):
    """
    La base no respondió ni después de los reintentos de core/db.py: 503 con un código estable,
    para que la app vuelva a intentar sola en vez de mostrar "algo salió mal". Cualquier otro
    error de la base sigue siendo un 500.
    """
    if not es_transitorio(exc.orig):
        raise exc
    return JSONResponse(
        status_code=503,
        content={"detail": {"codigo": "base_no_disponible", "mensaje": "Estamos preparando tu cuenta. Intenta de nuevo en unos segundos."}},
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)):
    """
    La app lo llama apenas carga, sin esperar el inicio de sesión: así la base serverless
    (que se pausa sola sin uso) empieza a despertar mientras la persona está en la página de
    Microsoft, y /auth/me no tiene que esperarla. Solo un SELECT 1, sin datos.
    """
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
