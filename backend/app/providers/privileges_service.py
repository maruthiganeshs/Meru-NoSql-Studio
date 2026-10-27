from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Connection
from app.providers.factory import get_provider
from app.security.os_privileges import (
    OsPrivileges,
    merge_privileges,
    privileges_from_json,
    require_privilege,
)


async def resolve_connection_privileges(
    session: AsyncSession,
    connection_id: int,
    *,
    probe: bool = True,
) -> OsPrivileges:
    conn = await session.get(Connection, connection_id)
    if conn is None:
        raise LookupError(f"Connection {connection_id} not found")
    overrides = privileges_from_json(conn.os_privileges_json)
    probed: OsPrivileges | None = None
    if probe:
        provider = await get_provider(session, connection_id)
        try:
            probed = await provider.probe_privileges()
        finally:
            await provider.close()
    return merge_privileges(overrides, probed)


async def assert_connection_privilege(
    session: AsyncSession,
    connection_id: int,
    capability: str,
) -> OsPrivileges:
    privs = await resolve_connection_privileges(session, connection_id, probe=True)
    try:
        require_privilege(privs, capability)
    except PermissionError as exc:
        raise PermissionError(str(exc)) from exc
    return privs
