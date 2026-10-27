from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    QueryHistoryOut,
    SampleQueryCreate,
    SampleQueryOut,
    SearchRequest,
)
from app.config import get_settings
from app.db.database import get_session
from app.db.models import QueryHistory, SampleQuery
from app.providers.factory import get_provider

router = APIRouter(tags=["queries"])


DEFAULT_SAMPLES = [
    {
        "name": "Match all",
        "description": "Search — return all documents",
        "body": '{\n  "query": {\n    "match_all": {}\n  }\n}',
    },
    {
        "name": "Match query",
        "description": "Search — full-text match on a field",
        "body": '{\n  "query": {\n    "match": {\n      "FIELD": "VALUE"\n    }\n  }\n}',
    },
    {
        "name": "Multi match",
        "description": "Search — multi_match across fields",
        "body": '{\n  "query": {\n    "multi_match": {\n      "query": "VALUE",\n      "fields": ["FIELD1", "FIELD2"]\n    }\n  }\n}',
    },
    {
        "name": "Term filter",
        "description": "Search — exact term filter",
        "body": '{\n  "query": {\n    "bool": {\n      "filter": [\n        { "term": { "FIELD.keyword": "VALUE" } }\n      ]\n    }\n  }\n}',
    },
    {
        "name": "Terms query",
        "description": "Search — match any of several terms",
        "body": '{\n  "query": {\n    "terms": {\n      "FIELD.keyword": ["VALUE1", "VALUE2"]\n    }\n  }\n}',
    },
    {
        "name": "Range query",
        "description": "Search — numeric or date range",
        "body": '{\n  "query": {\n    "range": {\n      "FIELD": {\n        "gte": 0,\n        "lte": 100\n      }\n    }\n  }\n}',
    },
    {
        "name": "Bool must / should",
        "description": "Search — boolean combination",
        "body": '{\n  "query": {\n    "bool": {\n      "must": [\n        { "match": { "FIELD": "VALUE" } }\n      ],\n      "filter": [\n        { "term": { "STATUS.keyword": "active" } }\n      ],\n      "should": [\n        { "term": { "TAG.keyword": "featured" } }\n      ],\n      "minimum_should_match": 0\n    }\n  }\n}',
    },
    {
        "name": "Exists field",
        "description": "Search — documents where a field exists",
        "body": '{\n  "query": {\n    "exists": {\n      "field": "FIELD"\n    }\n  }\n}',
    },
    {
        "name": "Wildcard",
        "description": "Search — wildcard pattern",
        "body": '{\n  "query": {\n    "wildcard": {\n      "FIELD.keyword": "pre*"\n    }\n  }\n}',
    },
    {
        "name": "Prefix",
        "description": "Search — prefix match",
        "body": '{\n  "query": {\n    "prefix": {\n      "FIELD.keyword": "pre"\n    }\n  }\n}',
    },
    {
        "name": "Sort + size",
        "description": "Search — with sort and size",
        "body": '{\n  "size": 20,\n  "sort": [\n    { "FIELD": { "order": "desc" } }\n  ],\n  "query": {\n    "match_all": {}\n  }\n}',
    },
    {
        "name": "Source filtering",
        "description": "Search — return selected fields only",
        "body": '{\n  "_source": ["FIELD1", "FIELD2"],\n  "query": {\n    "match_all": {}\n  }\n}',
    },
    {
        "name": "Aggregation terms",
        "description": "Search — terms aggregation",
        "body": '{\n  "size": 0,\n  "aggs": {\n    "by_field": {\n      "terms": {\n        "field": "FIELD.keyword",\n        "size": 10\n      }\n    }\n  }\n}',
    },
    {
        "name": "Count (body)",
        "description": "Search body usable with _count semantics (match_all)",
        "body": '{\n  "query": {\n    "match_all": {}\n  }\n}',
    },
    {
        "name": "Nested query",
        "description": "Search — nested object query",
        "body": '{\n  "query": {\n    "nested": {\n      "path": "NESTED_PATH",\n      "query": {\n        "match": { "NESTED_PATH.FIELD": "VALUE" }\n      }\n    }\n  }\n}',
    },
]


@router.get("/sample-queries", response_model=list[SampleQueryOut])
async def list_sample_queries(
    connection_id: int | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[SampleQueryOut]:
    stmt = select(SampleQuery).order_by(SampleQuery.name)
    if connection_id is not None:
        stmt = stmt.where(
            (SampleQuery.connection_id == connection_id) | (SampleQuery.connection_id.is_(None))
        )
    existing = (await session.execute(select(SampleQuery).where(SampleQuery.connection_id.is_(None)))).scalars().all()
    existing_names = {r.name for r in existing}
    added = False
    for sample in DEFAULT_SAMPLES:
        if sample["name"] not in existing_names:
            session.add(
                SampleQuery(
                    name=sample["name"],
                    body=sample["body"],
                    description=sample["description"],
                    engine_type="opensearch",
                    connection_id=None,
                )
            )
            added = True
    if added:
        await session.commit()

    rows = (await session.execute(stmt)).scalars().all()
    return [SampleQueryOut.model_validate(r) for r in rows]


@router.post("/sample-queries", response_model=SampleQueryOut, status_code=201)
async def create_sample_query(
    payload: SampleQueryCreate,
    session: AsyncSession = Depends(get_session),
) -> SampleQueryOut:
    row = SampleQuery(
        name=payload.name,
        body=payload.body,
        description=payload.description,
        connection_id=payload.connection_id,
        engine_type=payload.engine_type,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return SampleQueryOut.model_validate(row)


@router.delete("/sample-queries/{sample_id}", status_code=204)
async def delete_sample_query(
    sample_id: int,
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.get(SampleQuery, sample_id)
    if not row:
        raise HTTPException(status_code=404, detail="Sample query not found")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@router.get("/connections/{connection_id}/query-history", response_model=list[QueryHistoryOut])
async def list_query_history(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[QueryHistoryOut]:
    rows = (
        await session.execute(
            select(QueryHistory)
            .where(QueryHistory.connection_id == connection_id)
            .order_by(QueryHistory.created_at.desc())
            .limit(get_settings().query_history_limit)
        )
    ).scalars().all()
    return [QueryHistoryOut.model_validate(r) for r in rows]


@router.post("/os/{connection_id}/indices/{index_name}/query")
async def run_query(
    connection_id: int,
    index_name: str,
    payload: SearchRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        provider = await get_provider(session, connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ok = True
    error_message = None
    result_payload: dict = {}
    try:
        result = await provider.search(
            index_name,
            payload.body,
            from_=payload.from_,
            size=payload.size,
        )
        result_payload = result.model_dump()
    except Exception as exc:
        ok = False
        error_message = str(exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await provider.close()
        import json

        session.add(
            QueryHistory(
                connection_id=connection_id,
                index_name=index_name,
                body=json.dumps(payload.body),
                ok=ok,
                error_message=error_message,
            )
        )
        # Cap history
        limit = get_settings().query_history_limit
        ids = (
            await session.execute(
                select(QueryHistory.id)
                .where(QueryHistory.connection_id == connection_id)
                .order_by(QueryHistory.created_at.desc())
            )
        ).scalars().all()
        if len(ids) >= limit:
            stale = ids[limit:]
            if stale:
                await session.execute(delete(QueryHistory).where(QueryHistory.id.in_(stale)))
        await session.commit()

    return result_payload
