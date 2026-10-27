from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_dir(url: str) -> None:
    if "sqlite" not in url:
        return
    # sqlite+aiosqlite:///./data/studio.db or absolute ////data/studio.db
    if ":///" in url:
        path_part = url.split(":///", 1)[1]
        if path_part and path_part != ":memory:":
            path = Path(path_part)
            if not path.is_absolute():
                # Resolve relative to backend/ working directory
                path = (Path.cwd() / path).resolve()
            path.parent.mkdir(parents=True, exist_ok=True)


settings = get_settings()
_ensure_sqlite_dir(settings.database_url)

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    from app.db import models  # noqa: F401
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        def _ensure_columns(sync_conn) -> None:
            if "sqlite" not in str(sync_conn.engine.url):
                return
            rows = sync_conn.execute(text("PRAGMA table_info(connections)")).fetchall()
            cols = {r[1] for r in rows}
            if "os_privileges_json" not in cols:
                sync_conn.execute(
                    text("ALTER TABLE connections ADD COLUMN os_privileges_json TEXT")
                )

        await conn.run_sync(_ensure_columns)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
