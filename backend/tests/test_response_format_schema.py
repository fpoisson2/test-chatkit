import pytest

pydantic = pytest.importorskip("pydantic")
BaseModel = pydantic.BaseModel

from backend.app.chatkit import (
    _build_output_type_from_response_format,
    _create_response_format_from_pydantic,
)


def _dump_instance(model_cls, payload):
    if hasattr(model_cls, "model_validate"):
        instance = model_cls.model_validate(payload)
        return instance.model_dump(by_alias=True)
    instance = model_cls(**payload)
    return instance.dict(by_alias=True)


def _model_schema(model_cls):
    if hasattr(model_cls, "model_json_schema"):
        return model_cls.model_json_schema()
    return model_cls.schema()


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

    dumped = _dump_instance(output_type, payload)

    assert dumped["children.0.children.1.label"] == "Télécharger"
    assert dumped["title"] == "Widget"

    schema = _model_schema(output_type)

    def _contains_additional_properties(data):
        if isinstance(data, dict):
            if "additionalProperties" in data:
                return True
            return any(_contains_additional_properties(value) for value in data.values())
        if isinstance(data, list):
            return any(_contains_additional_properties(item) for item in data)
        return False

    assert not _contains_additional_properties(schema)


def test_response_format_with_anyof_schema():
    response_format = {
        "type": "json_schema",
        "name": "ImageWidget",
        "schema": {
            "type": "object",
            "properties": {
                "children.0.children.1.label": {
                    "anyOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}},
                        {"type": "null"},
                    ]
                },
                "title": {"type": "string"},
            },
            "required": ["children.0.children.1.label"],
        },
    }

    output_type = _build_output_type_from_response_format(response_format, fallback=None)
    assert output_type is not None
    assert issubclass(output_type, BaseModel)

    dumped_string = _dump_instance(
        output_type,
        {
            "children.0.children.1.label": "Télécharger",
            "title": "Widget",
        },
    )
    assert dumped_string["children.0.children.1.label"] == "Télécharger"

    dumped_list = _dump_instance(
        output_type,
        {
            "children.0.children.1.label": ["Télécharger", "Maintenant"],
            "title": "Widget",
        },
    )
    assert dumped_list["children.0.children.1.label"] == ["Télécharger", "Maintenant"]

    response_format_schema = _create_response_format_from_pydantic(output_type)
    schema = response_format_schema["json_schema"]["schema"]
    property_schema = schema["properties"]["children.0.children.1.label"]

    assert "type" in property_schema or "anyOf" in property_schema
    if "anyOf" in property_schema:
        assert all("type" in option for option in property_schema["anyOf"])
