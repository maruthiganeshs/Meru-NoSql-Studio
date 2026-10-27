from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


EngineType = Literal["opensearch", "elasticsearch"]
AuthMode = Literal["none", "basic", "apiKey"]


class OsPrivilegesOverride(BaseModel):
    cluster_monitor: bool | None = None
    index_read: bool | None = None
    index_create: bool | None = None
    index_delete: bool | None = None
    document_read: bool | None = None
    document_write: bool | None = None
    bulk_write: bool | None = None


class ConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    engine_type: EngineType = "opensearch"
    host_url: str = Field(min_length=1, max_length=500)
    auth_mode: AuthMode
    ssl_verify: bool = True
    username: str | None = None
    password: str | None = None
    api_key: str | None = None
    os_privileges: OsPrivilegesOverride | None = None

    @field_validator("host_url")
    @classmethod
    def normalize_url(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @model_validator(mode="after")
    def validate_auth_fields(self) -> "ConnectionCreate":
        if self.auth_mode == "basic" and (not self.username or not self.password):
            raise ValueError("username and password required for basic auth")
        if self.auth_mode == "apiKey" and not self.api_key:
            raise ValueError("api_key required for apiKey auth")
        return self


class ConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    host_url: str | None = None
    auth_mode: AuthMode | None = None
    ssl_verify: bool | None = None
    username: str | None = None
    password: str | None = None
    api_key: str | None = None
    clear_secrets: bool = False
    os_privileges: OsPrivilegesOverride | None = None


class ConnectionOut(BaseModel):
    id: int
    name: str
    engine_type: str
    host_url: str
    auth_mode: str
    ssl_verify: bool
    has_secrets: bool
    os_privileges: dict[str, Any] | None = None
    last_tested_at: datetime | None = None
    last_test_ok: bool | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConnectionTestDraft(BaseModel):
    name: str | None = None
    engine_type: EngineType = "opensearch"
    host_url: str = Field(min_length=1, max_length=500)
    auth_mode: AuthMode
    ssl_verify: bool = True
    username: str | None = None
    password: str | None = None
    api_key: str | None = None

    @field_validator("host_url")
    @classmethod
    def normalize_url(cls, value: str) -> str:
        return value.strip().rstrip("/")


class DocumentUpdateRequest(BaseModel):
    source: dict[str, Any]


class SearchRequest(BaseModel):
    body: dict[str, Any] = Field(default_factory=lambda: {"query": {"match_all": {}}})
    from_: int = Field(default=0, alias="from", ge=0)
    size: int = Field(default=50, ge=1, le=1000)

    model_config = {"populate_by_name": True}


class SampleQueryCreate(BaseModel):
    name: str
    body: str
    description: str | None = None
    connection_id: int | None = None
    engine_type: EngineType = "opensearch"


class SampleQueryOut(BaseModel):
    id: int
    name: str
    body: str
    description: str | None
    connection_id: int | None
    engine_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class QueryHistoryOut(BaseModel):
    id: int
    connection_id: int
    index_name: str | None
    body: str
    ok: bool
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class FieldMapping(BaseModel):
    field: str
    type: str

    @field_validator("type")
    @classmethod
    def require_explicit_type(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("field type is required; no fallback allowed")
        return cleaned


class ImportRequest(BaseModel):
    index: str = Field(min_length=1)
    documents: list[dict[str, Any]]
    field_mappings: list[FieldMapping]
    create_index: bool = True

    @model_validator(mode="after")
    def all_fields_mapped(self) -> "ImportRequest":
        if not self.documents:
            raise ValueError("documents must not be empty")
        keys: set[str] = set()
        for doc in self.documents:
            keys.update(k for k in doc.keys() if k != "_id")
        mapped = {m.field for m in self.field_mappings}
        missing = sorted(keys - mapped)
        if missing:
            raise ValueError(
                f"Explicit mapping required for fields (no type fallback): {', '.join(missing)}"
            )
        empty_types = [m.field for m in self.field_mappings if not m.type.strip()]
        if empty_types:
            raise ValueError(f"Empty types not allowed: {', '.join(empty_types)}")
        return self


class ExportRequest(BaseModel):
    index: str
    query: dict[str, Any] | None = None
    format: Literal["json", "jsonl", "csv"] = "json"
    include_schema: bool = False


class FieldValuesRequest(BaseModel):
    field: str = Field(min_length=1)
    size: int = Field(default=10, ge=1, le=50)
    search: str | None = None
