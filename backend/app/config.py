from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Meru-NoSql-Studio"
    app_secret_key: str = "dev-change-me-generate-a-fernet-key"
    database_url: str = "sqlite+aiosqlite:///../data/studio.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    query_history_limit: int = 200

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
