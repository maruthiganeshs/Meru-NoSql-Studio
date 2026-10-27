from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import DocumentUpdateRequest, FieldValuesRequest, SearchRequest
from app.db.database import get_session
from app.providers.factory import get_provider
from app.providers.privileges_service import (
    assert_connection_privilege,
    resolve_connection_privileges,
)

router = APIRouter(prefix="/os/{connection_id}", tags=["opensearch"])


async def _provider(connection_id: int, session: AsyncSession):
    try:
        return await get_provider(session, connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _forbid(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=502, detail=str(exc))


@router.get("/privileges")
async def get_privileges(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        privs = await resolve_connection_privileges(session, connection_id, probe=True)
        return privs.model_dump()
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/cluster")
async def cluster_overview(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    provider = await _provider(connection_id, session)
    try:
        overview = await provider.cluster_overview()
        return overview.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.get("/nodes")
async def list_nodes(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    provider = await _provider(connection_id, session)
    try:
        nodes = await provider.list_nodes()
        return [n.model_dump() for n in nodes]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.get("/indices")
async def list_indices(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    provider = await _provider(connection_id, session)
    try:
        indices = await provider.list_indices()
        return [i.model_dump() for i in indices]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.delete("/indices/{index_name}")
async def delete_index(
    connection_id: int,
    index_name: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        await assert_connection_privilege(session, connection_id, "index_delete")
    except (PermissionError, LookupError) as exc:
        raise _forbid(exc) from exc

    provider = await _provider(connection_id, session)
    try:
        return await provider.delete_index(index_name)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.post("/indices/{index_name}/field-values")
async def field_values(
    connection_id: int,
    index_name: str,
    payload: FieldValuesRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    provider = await _provider(connection_id, session)
    try:
        values = await provider.field_values(
            index_name,
            payload.field,
            size=payload.size,
            search=payload.search,
        )
        return {"field": payload.field, "values": values}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.get("/indices/{index_name}/mapping")
async def get_mapping(
    connection_id: int,
    index_name: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    provider = await _provider(connection_id, session)
    try:
        mapping = await provider.get_mapping(index_name)
        return mapping.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.post("/indices/{index_name}/search")
async def search_index(
    connection_id: int,
    index_name: str,
    payload: SearchRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    provider = await _provider(connection_id, session)
    try:
        result = await provider.search(
            index_name,
            payload.body,
            from_=payload.from_,
            size=payload.size,
        )
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.get("/indices/{index_name}/docs/{doc_id}")
async def get_document(
    connection_id: int,
    index_name: str,
    doc_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    provider = await _provider(connection_id, session)
    try:
        doc = await provider.get_document(index_name, doc_id)
        return doc.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.put("/indices/{index_name}/docs/{doc_id}")
async def update_document(
    connection_id: int,
    index_name: str,
    doc_id: str,
    payload: DocumentUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        await assert_connection_privilege(session, connection_id, "document_write")
    except (PermissionError, LookupError) as exc:
        raise _forbid(exc) from exc

    provider = await _provider(connection_id, session)
    try:
        doc = await provider.update_document(index_name, doc_id, payload.source)
        return doc.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()
