from collections.abc import AsyncIterator
from typing import Any, Protocol

from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    host_url: str
    auth_mode: str  # none | basic | apiKey
    ssl_verify: bool = True
    username: str | None = None
    password: str | None = None
    api_key: str | None = None


class HealthResult(BaseModel):
    ok: bool
    message: str
    cluster_name: str | None = None
    version: str | None = None


class ClusterOverview(BaseModel):
    cluster_name: str
    status: str
    version: str | None = None
    number_of_nodes: int = 0
    number_of_data_nodes: int = 0
    active_primary_shards: int = 0
    active_shards: int = 0
    relocating_shards: int = 0
    initializing_shards: int = 0
    unassigned_shards: int = 0
    delayed_unassigned_shards: int = 0
    docs_count: int = 0
    store_size_bytes: int = 0
    indices_count: int = 0


class NodeSummary(BaseModel):
    id: str
    name: str
    ip: str | None = None
    version: str | None = None
    roles: list[str] = Field(default_factory=list)
    master: bool = False
    heap_percent: float | None = None
    ram_percent: float | None = None
    disk_percent: float | None = None
    cpu_percent: float | None = None
    shard_count: int | None = None
    mapping_count: int | None = None


class IndexSummary(BaseModel):
    index: str
    uuid: str | None = None
    health: str | None = None
    status: str | None = None
    docs_count: int | None = None
    store_size: str | None = None
    store_size_bytes: int | None = None
    pri: int | None = None
    rep: int | None = None
    aliases: list[str] = Field(default_factory=list)


class MappingDoc(BaseModel):
    index: str
    mappings: dict[str, Any]


class SearchResult(BaseModel):
    took: int | None = None
    timed_out: bool | None = None
    hits_total: int | None = None
    hits: list[dict[str, Any]] = Field(default_factory=list)
    aggregations: dict[str, Any] | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class Document(BaseModel):
    index: str
    id: str
    source: dict[str, Any]
    found: bool = True


class ImportResult(BaseModel):
    indexed: int
    errors: list[str] = Field(default_factory=list)


class DatabaseProvider(Protocol):
    async def test_connection(self) -> HealthResult: ...

    async def cluster_overview(self) -> ClusterOverview: ...

    async def list_nodes(self) -> list[NodeSummary]: ...

    async def list_indices(self) -> list[IndexSummary]: ...

    async def get_mapping(self, index: str) -> MappingDoc: ...

    async def search(
        self,
        index: str,
        body: dict[str, Any],
        from_: int = 0,
        size: int = 50,
    ) -> SearchResult: ...

    async def get_document(self, index: str, doc_id: str) -> Document: ...

    async def bulk_import(
        self,
        index: str,
        docs: list[dict[str, Any]],
        mapping: dict[str, Any],
        create_index: bool = True,
    ) -> ImportResult: ...

    async def export_docs(
        self,
        index: str,
        query: dict[str, Any],
        fmt: str,
    ) -> AsyncIterator[bytes]: ...

    async def close(self) -> None: ...
