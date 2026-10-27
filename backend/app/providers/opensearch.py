from __future__ import annotations

import csv
import io
import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import httpx

from app.providers.base import (
    ClusterOverview,
    Document,
    HealthResult,
    ImportResult,
    IndexSummary,
    MappingDoc,
    NodeSummary,
    ProviderConfig,
    SearchResult,
)


def is_local_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def validate_auth_strict(config: ProviderConfig) -> None:
    """Require auth for non-local OpenSearch endpoints."""
    if is_local_host(config.host_url):
        return
    if config.auth_mode == "none":
        raise ValueError("Remote OpenSearch connections require auth_mode basic or apiKey")
    if config.auth_mode == "basic":
        if not config.username or not config.password:
            raise ValueError("Basic auth requires username and password")
    elif config.auth_mode == "apiKey":
        if not config.api_key:
            raise ValueError("API key auth requires api_key")
    else:
        raise ValueError(f"Unsupported auth_mode: {config.auth_mode}")


class OpenSearchProvider:
    def __init__(self, config: ProviderConfig) -> None:
        validate_auth_strict(config)
        self.config = config
        self._client = httpx.AsyncClient(
            base_url=config.host_url.rstrip("/"),
            verify=config.ssl_verify,
            timeout=httpx.Timeout(60.0, connect=15.0),
            headers=self._build_headers(),
            auth=self._build_auth(),
        )

    def _build_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.config.auth_mode == "apiKey" and self.config.api_key:
            key = self.config.api_key.strip()
            if key.lower().startswith("apikey "):
                headers["Authorization"] = key
            else:
                headers["Authorization"] = f"ApiKey {key}"
        return headers

    def _build_auth(self) -> httpx.BasicAuth | None:
        if self.config.auth_mode == "basic" and self.config.username and self.config.password:
            return httpx.BasicAuth(self.config.username, self.config.password)
        return None

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        response = await self._client.request(
            method,
            path,
            params=params,
            json=json_body,
            content=content,
            headers=headers,
        )
        if response.status_code >= 400:
            detail = response.text[:2000]
            raise RuntimeError(f"OpenSearch {method} {path} failed ({response.status_code}): {detail}")
        if not response.content:
            return {}
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type or response.text[:1] in "{[":
            return response.json()
        return response.text

    async def test_connection(self) -> HealthResult:
        try:
            info = await self._request("GET", "/")
            health = await self._request("GET", "/_cluster/health")
            version = None
            if isinstance(info, dict):
                version = (info.get("version") or {}).get("number")
            return HealthResult(
                ok=True,
                message="Connection successful",
                cluster_name=health.get("cluster_name") if isinstance(health, dict) else None,
                version=version,
            )
        except Exception as exc:
            return HealthResult(ok=False, message=str(exc))

    async def cluster_overview(self) -> ClusterOverview:
        health = await self._request("GET", "/_cluster/health")
        stats = await self._request("GET", "/_cluster/stats")
        info = await self._request("GET", "/")
        indices = stats.get("indices", {}) if isinstance(stats, dict) else {}
        docs = indices.get("docs", {})
        store = indices.get("store", {})
        version = None
        if isinstance(info, dict):
            version = (info.get("version") or {}).get("number")
        return ClusterOverview(
            cluster_name=health.get("cluster_name", ""),
            status=health.get("status", "unknown"),
            version=version,
            number_of_nodes=health.get("number_of_nodes", 0),
            number_of_data_nodes=health.get("number_of_data_nodes", 0),
            active_primary_shards=health.get("active_primary_shards", 0),
            active_shards=health.get("active_shards", 0),
            relocating_shards=health.get("relocating_shards", 0),
            initializing_shards=health.get("initializing_shards", 0),
            unassigned_shards=health.get("unassigned_shards", 0),
            delayed_unassigned_shards=health.get("delayed_unassigned_shards", 0),
            docs_count=int(docs.get("count") or 0),
            store_size_bytes=int(store.get("size_in_bytes") or 0),
            indices_count=int(indices.get("count") or 0),
        )

    async def list_nodes(self) -> list[NodeSummary]:
        nodes_stats = await self._request("GET", "/_nodes/stats")
        nodes = nodes_stats.get("nodes", {}) if isinstance(nodes_stats, dict) else {}
        result: list[NodeSummary] = []
        for node_id, node in nodes.items():
            jvm = node.get("jvm", {})
            mem = jvm.get("mem", {})
            os_mem = node.get("os", {}).get("mem", {})
            fs = node.get("fs", {}).get("total", {})
            process = node.get("process", {}).get("cpu", {})
            roles = node.get("roles") or []
            total_disk = fs.get("total_in_bytes") or 0
            avail = fs.get("available_in_bytes") or 0
            disk_pct = None
            if total_disk:
                disk_pct = round(((total_disk - avail) / total_disk) * 100, 2)
            indices_stats = node.get("indices", {})
            shard_count = None
            mapping_count = None
            try:
                shard_count = int((indices_stats.get("shards") or {}).get("total") or 0)
            except (TypeError, ValueError):
                shard_count = None
            try:
                mapping_count = int(
                    (indices_stats.get("mappings") or {}).get("total_count")
                    or (indices_stats.get("docs") or {}).get("count")
                    or 0
                )
            except (TypeError, ValueError):
                mapping_count = None
            result.append(
                NodeSummary(
                    id=node_id,
                    name=node.get("name") or node_id,
                    ip=node.get("ip") or (node.get("transport_address") or "").split(":")[0],
                    version=node.get("version"),
                    roles=list(roles),
                    master="master" in roles or "cluster_manager" in roles,
                    heap_percent=mem.get("heap_used_percent"),
                    ram_percent=os_mem.get("used_percent"),
                    disk_percent=disk_pct,
                    cpu_percent=process.get("percent"),
                    shard_count=shard_count,
                    mapping_count=mapping_count,
                )
            )
        return result

    async def list_indices(self) -> list[IndexSummary]:
        cat = await self._request(
            "GET",
            "/_cat/indices",
            params={"format": "json", "bytes": "b", "h": "index,uuid,health,status,docs.count,store.size,pri,rep"},
        )
        aliases_raw = await self._request("GET", "/_aliases")
        alias_map: dict[str, list[str]] = {}
        if isinstance(aliases_raw, dict):
            for index_name, meta in aliases_raw.items():
                alias_map[index_name] = list((meta.get("aliases") or {}).keys())

        rows: list[IndexSummary] = []
        if not isinstance(cat, list):
            return rows
        for row in cat:
            index_name = row.get("index", "")
            store_bytes = None
            raw_size = row.get("store.size")
            if raw_size not in (None, ""):
                try:
                    store_bytes = int(raw_size)
                except ValueError:
                    store_bytes = None
            docs = row.get("docs.count")
            docs_count = int(docs) if docs not in (None, "") else None
            pri = row.get("pri")
            rep = row.get("rep")
            rows.append(
                IndexSummary(
                    index=index_name,
                    uuid=row.get("uuid"),
                    health=row.get("health"),
                    status=row.get("status"),
                    docs_count=docs_count,
                    store_size=_pretty_bytes(store_bytes) if store_bytes is not None else None,
                    store_size_bytes=store_bytes,
                    pri=int(pri) if pri not in (None, "") else None,
                    rep=int(rep) if rep not in (None, "") else None,
                    aliases=alias_map.get(index_name, []),
                )
            )
        return sorted(rows, key=lambda r: r.index)

    async def get_mapping(self, index: str) -> MappingDoc:
        raw = await self._request("GET", f"/{index}/_mapping")
        if not isinstance(raw, dict) or not raw:
            raise RuntimeError(f"No mapping found for index {index}")
        # Response keyed by concrete index name
        first_key = next(iter(raw.keys()))
        mappings = raw[first_key].get("mappings", {})
        return MappingDoc(index=first_key, mappings=mappings)

    async def search(
        self,
        index: str,
        body: dict[str, Any],
        from_: int = 0,
        size: int = 50,
    ) -> SearchResult:
        payload = dict(body or {})
        payload.setdefault("from", from_)
        payload.setdefault("size", size)
        payload.setdefault("track_total_hits", True)
        raw = await self._request("POST", f"/{index}/_search", json_body=payload)
        hits_block = raw.get("hits", {}) if isinstance(raw, dict) else {}
        total = hits_block.get("total")
        hits_total = total.get("value") if isinstance(total, dict) else total
        return SearchResult(
            took=raw.get("took") if isinstance(raw, dict) else None,
            timed_out=raw.get("timed_out") if isinstance(raw, dict) else None,
            hits_total=hits_total,
            hits=hits_block.get("hits") or [],
            aggregations=raw.get("aggregations") if isinstance(raw, dict) else None,
            raw=raw if isinstance(raw, dict) else {},
        )

    async def get_document(self, index: str, doc_id: str) -> Document:
        raw = await self._request("GET", f"/{index}/_doc/{doc_id}")
        return Document(
            index=index,
            id=str(raw.get("_id", doc_id)),
            source=raw.get("_source") or {},
            found=bool(raw.get("found", True)),
        )

    async def update_document(self, index: str, doc_id: str, source: dict[str, Any]) -> Document:
        await self._request("PUT", f"/{index}/_doc/{doc_id}", json_body=source)
        return Document(index=index, id=doc_id, source=source, found=True)

    async def delete_index(self, index: str) -> dict[str, Any]:
        raw = await self._request("DELETE", f"/{index}")
        return raw if isinstance(raw, dict) else {"acknowledged": True}

    async def probe_privileges(self):
        from app.security.os_privileges import (
            DEFAULT_PRIVILEGES,
            HAS_PRIVILEGES_BODY,
            parse_has_privileges_response,
            privileges_from_user_info,
        )

        errors: list[str] = []
        for path in ("/_security/user/_has_privileges",):
            try:
                response = await self._client.post(path, json=HAS_PRIVILEGES_BODY)
                if response.status_code < 400:
                    return parse_has_privileges_response(response.json())
                errors.append(f"{path} -> {response.status_code}")
            except Exception as exc:
                errors.append(f"{path} -> {exc}")

        # Secondary: user / account info (admin-style roles)
        for path in (
            "/_security/user/_authenticate",
            "/_plugins/_security/api/account",
            "/_security/user",
        ):
            try:
                response = await self._client.get(path)
                if response.status_code >= 400:
                    errors.append(f"{path} -> {response.status_code}")
                    continue
                data = response.json()
                if isinstance(data, dict):
                    # /_security/user may be map of username -> info
                    if "roles" not in data and len(data) == 1:
                        data = next(iter(data.values()))
                    inferred = privileges_from_user_info(data if isinstance(data, dict) else {})
                    if inferred:
                        return inferred
            except Exception as exc:
                errors.append(f"{path} -> {exc}")

        # Security plugin absent (common on local/dev): allow destructive ops when
        # authenticated connection already reached the cluster successfully.
        try:
            health = await self._client.get("/_cluster/health")
            if health.status_code < 400:
                return DEFAULT_PRIVILEGES.model_copy(
                    update={
                        "index_delete": True,
                        "document_write": True,
                        "bulk_write": True,
                        "index_create": True,
                        "source": "heuristic",
                        "probe_available": False,
                        "probe_error": (
                            "Security privileges API unavailable; "
                            "granting manage-style access for authenticated cluster. "
                            + "; ".join(errors[:3])
                        ),
                    }
                )
        except Exception as exc:
            errors.append(str(exc))

        return DEFAULT_PRIVILEGES.model_copy(
            update={
                "source": "defaults",
                "probe_available": False,
                "probe_error": "; ".join(errors) if errors else "probe failed",
            }
        )

    async def field_values(
        self,
        index: str,
        field: str,
        *,
        size: int = 10,
        search: str | None = None,
    ) -> list[dict]:
        """Top terms for a field via aggregation (for facet filters)."""
        mapping = await self.get_mapping(index)
        agg_field = _resolve_agg_field(mapping.mappings, field)
        if agg_field is None:
            raise ValueError(f"Field '{field}' is object/nested or not aggregatable")

        terms: dict[str, Any] = {"field": agg_field, "size": max(1, min(size, 50))}
        if search and search.strip():
            # Prefix/wildcard include on terms aggregation
            safe = search.strip().replace("*", "")
            terms["include"] = f".*{_escape_regex(safe)}.*"

        body = {
            "size": 0,
            "aggs": {"field_values": {"terms": terms}},
        }
        raw = await self._request("POST", f"/{index}/_search", json_body=body)
        buckets = (
            ((raw.get("aggregations") or {}).get("field_values") or {}).get("buckets") or []
        )
        return [
            {"value": b.get("key"), "count": b.get("doc_count", 0)}
            for b in buckets
            if b.get("key") is not None
        ]

    async def bulk_import(
        self,
        index: str,
        docs: list[dict[str, Any]],
        mapping: dict[str, Any],
        create_index: bool = True,
    ) -> ImportResult:
        if create_index:
            exists = await self._client.head(f"/{index}")
            if exists.status_code == 404:
                await self._request(
                    "PUT",
                    f"/{index}",
                    json_body={"mappings": mapping},
                )

        lines: list[str] = []
        for doc in docs:
            doc_id = doc.pop("_id", None)
            action: dict[str, Any] = {"index": {"_index": index}}
            if doc_id is not None:
                action["index"]["_id"] = doc_id
            lines.append(json.dumps(action))
            lines.append(json.dumps(doc))
        body = ("\n".join(lines) + "\n").encode("utf-8")
        raw = await self._request(
            "POST",
            "/_bulk",
            content=body,
            headers={"Content-Type": "application/x-ndjson"},
        )
        errors: list[str] = []
        indexed = 0
        for item in raw.get("items", []) if isinstance(raw, dict) else []:
            result = item.get("index") or item.get("create") or {}
            if result.get("error"):
                errors.append(json.dumps(result["error"]))
            else:
                indexed += 1
        return ImportResult(indexed=indexed, errors=errors)

    async def export_docs(
        self,
        index: str,
        query: dict[str, Any],
        fmt: str,
    ) -> AsyncIterator[bytes]:
        fmt = fmt.lower()
        body = {"query": query.get("query", {"match_all": {}}), "size": 1000}
        raw = await self._request("POST", f"/{index}/_search", json_body=body)
        hits = (raw.get("hits") or {}).get("hits") or []
        docs = [{"_id": h.get("_id"), **(h.get("_source") or {})} for h in hits]

        if fmt == "json":
            yield json.dumps(docs, indent=2).encode("utf-8")
            return
        if fmt == "jsonl":
            for doc in docs:
                yield (json.dumps(doc) + "\n").encode("utf-8")
            return
        if fmt == "csv":
            if not docs:
                yield b""
                return
            fieldnames: list[str] = []
            seen: set[str] = set()
            for doc in docs:
                for key in doc.keys():
                    if key not in seen:
                        seen.add(key)
                        fieldnames.append(key)
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for doc in docs:
                writer.writerow({k: _csv_value(doc.get(k)) for k in fieldnames})
            yield buf.getvalue().encode("utf-8")
            return
        raise ValueError(f"Unsupported export format: {fmt}")

    async def close(self) -> None:
        await self._client.aclose()


def _escape_regex(value: str) -> str:
    special = r"\.^$|?*+()[]{}\\"
    return "".join(f"\\{ch}" if ch in special else ch for ch in value)


def _resolve_agg_field(mappings: dict[str, Any], field: str) -> str | None:
    """Return aggregatable field name, or None for object/nested."""
    props = mappings.get("properties") if isinstance(mappings, dict) else None
    if not isinstance(props, dict):
        # Some responses nest under mappings.properties already flattened
        props = mappings if isinstance(mappings, dict) else {}

    parts = field.split(".")
    node: Any = props
    for part in parts:
        if not isinstance(node, dict):
            return None
        # Navigate properties
        if part in node:
            node = node[part]
        elif "properties" in node and isinstance(node["properties"], dict) and part in node["properties"]:
            node = node["properties"][part]
        else:
            # Unknown field — try .keyword convention for text
            return f"{field}.keyword"

        if isinstance(node, dict) and "properties" in node and "type" not in node:
            node = {"type": "object", **node}

    if not isinstance(node, dict):
        return field

    field_type = node.get("type")
    if field_type in {"object", "nested"}:
        return None
    if field_type == "text":
        fields = node.get("fields") or {}
        if isinstance(fields, dict) and "keyword" in fields:
            return f"{field}.keyword"
        return None
    if field_type in {
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
        "ip",
        "version",
        "wildcard",
        "constant_keyword",
    }:
        return field
    if field_type is None and "properties" in node:
        return None
    return field


def _pretty_bytes(num: int) -> str:
    value = float(num)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.2f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{num} B"


def _csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)
