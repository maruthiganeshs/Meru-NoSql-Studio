from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Connection
from app.providers.base import ProviderConfig
from app.providers.opensearch import OpenSearchProvider
from app.security.secrets import decrypt_secret


def secrets_from_connection(conn: Connection) -> dict:
    if not conn.encrypted_secrets:
        return {}
    return json.loads(decrypt_secret(conn.encrypted_secrets))


def provider_config_from_connection(conn: Connection) -> ProviderConfig:
    secrets = secrets_from_connection(conn)
    return ProviderConfig(
        host_url=conn.host_url,
        auth_mode=conn.auth_mode,
        ssl_verify=conn.ssl_verify,
        username=secrets.get("username"),
        password=secrets.get("password"),
        api_key=secrets.get("api_key"),
    )


async def get_provider(session: AsyncSession, connection_id: int) -> OpenSearchProvider:
    conn = await session.get(Connection, connection_id)
    if conn is None:
        raise LookupError(f"Connection {connection_id} not found")
    if conn.engine_type not in {"opensearch", "elasticsearch"}:
        raise ValueError(f"Unsupported engine_type: {conn.engine_type}")
    return OpenSearchProvider(provider_config_from_connection(conn))
