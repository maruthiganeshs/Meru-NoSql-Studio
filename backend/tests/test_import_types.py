import pytest
from pydantic import ValidationError

from app.api.import_export import build_mapping_properties
from app.api.schemas import FieldMapping, ImportRequest
from app.providers.base import ProviderConfig
from app.providers.opensearch import validate_auth_strict


def test_import_rejects_missing_field_mapping():
    with pytest.raises(ValidationError):
        ImportRequest(
            index="demo",
            documents=[{"name": "a", "age": 1}],
            field_mappings=[FieldMapping(field="name", type="text")],
        )


def test_import_rejects_empty_type():
    with pytest.raises(ValidationError):
        FieldMapping(field="name", type="  ")


def test_build_mapping_no_fallback_unknown_type():
    with pytest.raises(ValueError, match="no fallback"):
        build_mapping_properties([FieldMapping(field="x", type="not_a_real_type")])


def test_remote_requires_auth():
    with pytest.raises(ValueError, match="require auth"):
        validate_auth_strict(
            ProviderConfig(host_url="https://opensearch.example:9200", auth_mode="none")
        )


def test_local_allows_none_auth():
    validate_auth_strict(ProviderConfig(host_url="http://localhost:9200", auth_mode="none"))
