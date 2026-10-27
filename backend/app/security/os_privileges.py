from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel


class OsPrivileges(BaseModel):
    """OpenSearch-scoped capabilities for a connection (not app login roles)."""

    cluster_monitor: bool = True
    index_read: bool = True
    index_create: bool = True
    index_delete: bool = False
    document_read: bool = True
    document_write: bool = True
    bulk_write: bool = True
    source: str = "defaults"  # defaults | probe | heuristic
    probe_available: bool = False
    probe_error: str | None = None


DEFAULT_PRIVILEGES = OsPrivileges()

DELETE_NAMES = frozenset(
    {
        "delete_index",
        "indices:admin/delete",
        "manage",
        "all",
        "indices_all",
    }
)
WRITE_NAMES = frozenset(
    {
        "write",
        "index",
        "create",
        "create_index",
        "manage",
        "all",
        "indices_all",
        "indices:data/write/index",
        "indices:data/write/bulk",
    }
)
READ_NAMES = frozenset({"read", "manage", "all", "indices_all", "indices:data/read/search"})


def privileges_from_json(raw: str | None) -> OsPrivileges | None:
    """Legacy stored overrides — ignored for auth decisions; kept for DB compat."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return OsPrivileges(**{**DEFAULT_PRIVILEGES.model_dump(), **data, "source": "overrides"})
    except Exception:
        return None


def merge_privileges(
    _overrides: OsPrivileges | None,
    probed: OsPrivileges | None,
) -> OsPrivileges:
    """Live probe / heuristic only — connection form overrides are not used."""
    if probed is not None:
        return probed
    return DEFAULT_PRIVILEGES.model_copy()


def require_privilege(privs: OsPrivileges, capability: str) -> None:
    allowed = getattr(privs, capability, None)
    if allowed is not True:
        raise PermissionError(
            f"OpenSearch privilege '{capability}' is not granted for this connection"
        )


def _truthy_priv(bucket: Any, *names: str) -> bool:
    """Support map {name: true} or list ['name', ...] privilege shapes."""
    if bucket is None:
        return False
    name_set = {n.lower() for n in names}
    if isinstance(bucket, dict):
        for key, val in bucket.items():
            if str(key).lower() in name_set and val is True:
                return True
        # Some APIs nest under "privileges"
        nested = bucket.get("privileges")
        if nested is not None and nested is not bucket:
            return _truthy_priv(nested, *names)
        return False
    if isinstance(bucket, list):
        return any(str(item).lower() in name_set for item in bucket)
    if isinstance(bucket, str):
        return bucket.lower() in name_set
    return False


def _index_privilege_bucket(raw: dict[str, Any]) -> Any:
    index = raw.get("index")
    if isinstance(index, list) and index:
        first = index[0]
        if isinstance(first, dict):
            return first.get("privileges", first)
        return first
    if isinstance(index, dict):
        return index.get("privileges", index)
    return raw.get("privileges")


def parse_has_privileges_response(raw: dict[str, Any]) -> OsPrivileges:
    """Map OpenSearch/ES _has_privileges response into OsPrivileges."""
    if isinstance(raw.get("has_all_requested"), bool) and raw.get("has_all_requested"):
        return OsPrivileges(
            cluster_monitor=True,
            index_read=True,
            index_create=True,
            index_delete=True,
            document_read=True,
            document_write=True,
            bulk_write=True,
            source="probe",
            probe_available=True,
        )

    cluster = raw.get("cluster") or {}
    index_privs = _index_privilege_bucket(raw)

    index_delete = _truthy_priv(index_privs, *DELETE_NAMES) or _truthy_priv(
        cluster, "manage", "all"
    )
    document_write = _truthy_priv(index_privs, *WRITE_NAMES)
    index_create = _truthy_priv(index_privs, "create_index", "manage", "all", "indices_all")
    index_read = _truthy_priv(index_privs, *READ_NAMES) or True
    bulk_write = _truthy_priv(index_privs, "write", "index", "all", "manage", "indices_all")

    return OsPrivileges(
        cluster_monitor=_truthy_priv(cluster, "monitor", "manage", "all") or True,
        index_read=index_read,
        index_create=index_create,
        index_delete=index_delete,
        document_read=index_read,
        document_write=document_write or index_delete,
        bulk_write=bulk_write or document_write,
        source="probe",
        probe_available=True,
    )


def privileges_from_user_info(raw: dict[str, Any]) -> OsPrivileges | None:
    """Infer from GET /_security/user or /_plugins/_security/api/account."""
    roles: list[str] = []
    if isinstance(raw.get("roles"), list):
        roles = [str(r).lower() for r in raw["roles"]]
    backend_roles = raw.get("backend_roles") or []
    if isinstance(backend_roles, list):
        roles.extend(str(r).lower() for r in backend_roles)

    # Nested OpenSearch account shape
    user = raw.get("user") if isinstance(raw.get("user"), dict) else raw
    if isinstance(user.get("roles"), list):
        roles.extend(str(r).lower() for r in user["roles"])

    powerful = {
        "all_access",
        "admin",
        "superuser",
        "security_manager",
        "manage",
        "opensearch_dashboards_admin",
    }
    if any(r in powerful or r.endswith("_admin") for r in roles):
        return OsPrivileges(
            cluster_monitor=True,
            index_read=True,
            index_create=True,
            index_delete=True,
            document_read=True,
            document_write=True,
            bulk_write=True,
            source="heuristic",
            probe_available=True,
            probe_error=None,
        )
    return None


HAS_PRIVILEGES_BODY: dict[str, Any] = {
    "cluster": ["monitor", "manage", "all"],
    "index": [
        {
            "names": ["*"],
            "privileges": [
                "read",
                "write",
                "create",
                "create_index",
                "delete_index",
                "manage",
                "index",
                "all",
            ],
        }
    ],
}
