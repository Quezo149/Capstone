from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    En local, estos valores vienen de local.settings.json (Azure Functions
    Core Tools los inyecta como variables de entorno al correr `func start`).
    En Azure, vienen de la configuración de la Function App (Settings > Environment variables).
    """

    # Azure SQL
    sql_server: str
    sql_database: str
    sql_user: str
    sql_password: str
    # Solo en local (SQL Server en Docker usa un certificado autofirmado)
    sql_trust_server_certificate: bool = False

    # Azure Blob Storage
    storage_account_name: str
    storage_account_key: str
    storage_container_comprobantes: str = "comprobantes"

    # Microsoft Entra External ID (validación de tokens del frontend)
    entra_tenant_id: str
    entra_client_id: str
    entra_issuer: str

    # Azure AI Document Intelligence
    document_intelligence_endpoint: str
    document_intelligence_key: str

    class Config:
        env_file = ".env"  # solo para desarrollo fuera de Functions Core Tools


@lru_cache
def get_settings() -> Settings:
    return Settings()
