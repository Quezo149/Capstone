from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, expenses

app = FastAPI(title="KontadorIA API")

# En Azure, el dominio real de Netlify reemplaza el localhost de desarrollo.
# TODO: mover esta lista a Settings (app.core.config) para no hardcodearla.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://kontadoria.netlify.app", "https://app.kontadoria.cl"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(expenses.router, prefix="/movimientos", tags=["movimientos"])


@app.get("/health")
def health_check():
    return {"status": "ok"}
