from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import ExportRequest, ImportRequest
from app.db.database import get_session
from app.providers.factory import get_provider

router = APIRouter(prefix="/os/{connection_id}", tags=["import-export"])

ALLOWED_ES_TYPES = {
    "text",
    "keyword",
    "long",
    "integer",
    "short",
    "byte",
    "double",
    "float",
    "half_float",
    "scaled_float",
    "date",
    "date_nanos",
    "boolean",
    "binary",
    "integer_range",
    "float_range",
    "long_range",
    "double_range",
    "date_range",
    "ip",
    "version",
    "object",
    "nested",
    "geo_point",
    "geo_shape",
    "completion",
    "token_count",
    "dense_vector",
    "rank_feature",
    "rank_features",
    "search_as_you_type",
    "alias",
    "flattened",
    "shape",
    "histogram",
    "constant_keyword",
    "wildcard",
    "point",
}


def build_mapping_properties(field_mappings: list) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    for item in field_mappings:
        field_type = item.type.strip()
        if field_type not in ALLOWED_ES_TYPES:
            raise ValueError(
                f"Unsupported or unknown type '{field_type}' for field '{item.field}'. "
                "Explicit OpenSearch/ES type required; no fallback."
            )
        properties[item.field] = {"type": field_type}
    return {"properties": properties}


@router.post("/import")
async def import_documents(
    connection_id: int,
    payload: ImportRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from app.providers.privileges_service import assert_connection_privilege

    try:
        await assert_connection_privilege(session, connection_id, "bulk_write")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        mapping = build_mapping_properties(payload.field_mappings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        provider = await get_provider(session, connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    docs = [dict(d) for d in payload.documents]
    try:
        result = await provider.bulk_import(
            payload.index,
            docs,
            mapping,
            create_index=payload.create_index,
        )
        return result.model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()


@router.post("/export")
async def export_documents(
    connection_id: int,
    payload: ExportRequest,
    session: AsyncSession = Depends(get_session),
):
    try:
        provider = await get_provider(session, connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media = {
        "json": "application/json",
        "jsonl": "application/x-ndjson",
        "csv": "text/csv",
    }.get(payload.format, "application/octet-stream")

    export_query = payload.query if payload.query else {"query": {"match_all": {}}}
    if "query" not in export_query:
        export_query = {"query": export_query}

    async def stream():
        try:
            if payload.include_schema:
                mapping = await provider.get_mapping(payload.index)
                header = {
                    "schema": mapping.mappings,
                    "note": "Types preserved from index mapping; no alteration applied",
                }
                yield (json.dumps(header) + "\n").encode("utf-8")
            async for chunk in provider.export_docs(payload.index, export_query, payload.format):
                yield chunk
        finally:
            await provider.close()

    filename = f"{payload.index}.{payload.format}"
    return StreamingResponse(
        stream(),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/infer-types")
async def infer_types(payload: dict[str, Any]) -> dict[str, Any]:
    """Suggest types from sample docs — suggestions only; never used as silent fallback."""
    documents = payload.get("documents") or []
    if not isinstance(documents, list) or not documents:
        raise HTTPException(status_code=400, detail="documents required")

    suggestions: dict[str, str] = {}
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        for key, value in doc.items():
            if key == "_id" or key in suggestions:
                continue
            suggestions[key] = _suggest_type(value)
    return {
        "suggestions": [{"field": k, "suggested_type": v} for k, v in sorted(suggestions.items())],
        "note": "Suggestions are advisory. Import requires an explicit type for every field.",
    }


def _suggest_type(value: Any) -> str:
    if value is None:
        return ""  # force explicit choice — empty means user must pick
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "long"
    if isinstance(value, float):
        return "double"
    if isinstance(value, list):
        return "nested" if value and isinstance(value[0], dict) else "keyword"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        return "text"
    return ""
