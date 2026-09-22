import azure.functions as func

from app.main import app as fastapi_app

# Modelo de programación v2: una sola Function HTTP que delega TODO
# el ruteo a FastAPI (incluido /docs, /openapi.json, etc.) vía ASGI.
app = func.AsgiFunctionApp(app=fastapi_app, http_auth_level=func.AuthLevel.ANONYMOUS)
