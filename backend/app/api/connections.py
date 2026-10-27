from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    ConnectionCreate,
    ConnectionOut,
    ConnectionTestDraft,
    ConnectionUpdate,
    OsPrivilegesOverride,
)
from app.db.database import get_session
from app.db.models import Connection
from app.providers.base import ProviderConfig
from app.providers.opensearch import OpenSearchProvider, validate_auth_strict
from app.security.os_privileges import (
    DEFAULT_PRIVILEGES,
    privileges_from_json,
)
from app.security.secrets import encrypt_secret

router = APIRouter(prefix="/connections", tags=["connections"])


def _pack_secrets(payload: ConnectionCreate | ConnectionUpdate | ConnectionTestDraft, existing: dict | None = None) -> str | None:
    secrets = dict(existing or {})
    if isinstance(payload, ConnectionUpdate) and payload.clear_secrets:
        return None
    if getattr(payload, "username", None) is not None:
        secrets["username"] = payload.username
    if getattr(payload, "password", None) is not None:
        secrets["password"] = payload.password
    if getattr(payload, "api_key", None) is not None:
        secrets["api_key"] = payload.api_key
    if not secrets:
        return None
    return encrypt_secret(json.dumps(secrets))


def _override_to_stored(override: OsPrivilegesOverride | None) -> str | None:
    if override is None:
        return None
    data = DEFAULT_PRIVILEGES.model_dump()
    for key, value in override.model_dump(exclude_none=True).items():
        data[key] = value
    data.pop("source", None)
    data.pop("probe_available", None)
    data.pop("probe_error", None)
    return json.dumps(data)


def _to_out(conn: Connection) -> ConnectionOut:
    overrides = privileges_from_json(conn.os_privileges_json)
    return ConnectionOut(
        id=conn.id,
        name=conn.name,
        engine_type=conn.engine_type,
        host_url=conn.host_url,
        auth_mode=conn.auth_mode,
        ssl_verify=conn.ssl_verify,
        has_secrets=bool(conn.encrypted_secrets),
        os_privileges=overrides.model_dump() if overrides else DEFAULT_PRIVILEGES.model_dump(),
        last_tested_at=conn.last_tested_at,
        last_test_ok=conn.last_test_ok,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


def _config_from_payload(payload: ConnectionCreate | ConnectionTestDraft) -> ProviderConfig:
    return ProviderConfig(
        host_url=payload.host_url,
        auth_mode=payload.auth_mode,
        ssl_verify=payload.ssl_verify,
        username=payload.username,
        password=payload.password,
        api_key=payload.api_key,
    )


@router.get("", response_model=list[ConnectionOut])
async def list_connections(session: AsyncSession = Depends(get_session)) -> list[ConnectionOut]:
    rows = (await session.execute(select(Connection).order_by(Connection.name))).scalars().all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=ConnectionOut, status_code=201)
async def create_connection(
    payload: ConnectionCreate,
    session: AsyncSession = Depends(get_session),
) -> ConnectionOut:
    try:
        validate_auth_strict(_config_from_payload(payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conn = Connection(
        name=payload.name,
        engine_type=payload.engine_type,
        host_url=payload.host_url,
        auth_mode=payload.auth_mode,
        ssl_verify=payload.ssl_verify,
        encrypted_secrets=_pack_secrets(payload),
        os_privileges_json=_override_to_stored(payload.os_privileges),
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return _to_out(conn)


@router.post("/test-draft")
async def test_draft_connection(payload: ConnectionTestDraft) -> dict:
    try:
        config = _config_from_payload(payload)
        validate_auth_strict(config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    provider = OpenSearchProvider(config)
    try:
        result = await provider.test_connection()
        probed = await provider.probe_privileges()
        return {
            **result.model_dump(),
            "privileges": probed.model_dump(),
        }
    finally:
        await provider.close()


@router.get("/{connection_id}", response_model=ConnectionOut)
async def get_connection(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> ConnectionOut:
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return _to_out(conn)


@router.put("/{connection_id}", response_model=ConnectionOut)
async def update_connection(
    connection_id: int,
    payload: ConnectionUpdate,
    session: AsyncSession = Depends(get_session),
) -> ConnectionOut:
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    if payload.name is not None:
        conn.name = payload.name
    if payload.host_url is not None:
        conn.host_url = payload.host_url.strip().rstrip("/")
    if payload.auth_mode is not None:
        conn.auth_mode = payload.auth_mode
    if payload.ssl_verify is not None:
        conn.ssl_verify = payload.ssl_verify
    if payload.os_privileges is not None:
        conn.os_privileges_json = _override_to_stored(payload.os_privileges)

    from app.providers.factory import secrets_from_connection

    existing = secrets_from_connection(conn) if conn.encrypted_secrets else {}
    packed = _pack_secrets(payload, existing)
    if payload.clear_secrets or packed is not None or any(
        x is not None for x in (payload.username, payload.password, payload.api_key)
    ):
        conn.encrypted_secrets = packed

    from app.providers.factory import provider_config_from_connection

    try:
        validate_auth_strict(provider_config_from_connection(conn))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await session.commit()
    await session.refresh(conn)
    return _to_out(conn)


@router.delete("/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> Response:
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    await session.delete(conn)
    await session.commit()
    return Response(status_code=204)


@router.post("/{connection_id}/test")
async def test_connection(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.providers.factory import get_provider
    from app.providers.privileges_service import resolve_connection_privileges

    try:
        provider = await get_provider(session, connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = await provider.test_connection()
    finally:
        await provider.close()

    conn = await session.get(Connection, connection_id)
    if conn:
        conn.last_tested_at = datetime.now(timezone.utc)
        conn.last_test_ok = result.ok
        await session.commit()

    privileges = await resolve_connection_privileges(session, connection_id, probe=True)
    return {**result.model_dump(), "privileges": privileges.model_dump()}
