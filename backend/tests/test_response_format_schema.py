import pytest

pydantic = pytest.importorskip("pydantic")
BaseModel = pydantic.BaseModel

from backend.app.chatkit import _build_output_type_from_response_format


@pytest.mark.parametrize(
    "response_format",
    [
        {
            "type": "json_schema",
            "name": "ImageWidget",
            "schema": {
                "type": "object",
                "properties": {
                    "children.0.children.1.label": {"type": "string"},
                    "title": {"type": "string"},
                },
                "required": ["children.0.children.1.label"],
            },
        }
    ],
)
def test_response_format_with_non_identifier_properties(response_format):
    output_type = _build_output_type_from_response_format(response_format, fallback=None)
    assert output_type is not None
    assert issubclass(output_type, BaseModel)

    payload = {
        "children.0.children.1.label": "Télécharger",
        "title": "Widget",
    }

    if hasattr(output_type, "model_validate"):
        instance = output_type.model_validate(payload)
        dumped = instance.model_dump(by_alias=True)
    else:
        instance = output_type(**payload)
        dumped = instance.dict(by_alias=True)

    assert dumped["children.0.children.1.label"] == "Télécharger"
    assert dumped["title"] == "Widget"

    if hasattr(output_type, "model_json_schema"):
        schema = output_type.model_json_schema()
    else:  # pragma: no cover - compatibilité Pydantic v1
        schema = output_type.schema()

    def _contains_additional_properties(data):
        if isinstance(data, dict):
            if "additionalProperties" in data:
                return True
            return any(_contains_additional_properties(value) for value in data.values())
        if isinstance(data, list):
            return any(_contains_additional_properties(item) for item in data)
        return False

    assert not _contains_additional_properties(schema)
