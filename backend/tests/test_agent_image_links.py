import importlib.util
import pathlib
import sys
from types import ModuleType, SimpleNamespace

import pytest

CHATKIT_MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "app" / "chatkit.py"
chatkit_spec = importlib.util.spec_from_file_location("app.chatkit", CHATKIT_MODULE_PATH)
chatkit_module = importlib.util.module_from_spec(chatkit_spec)
sys.modules.setdefault("app", ModuleType("app"))
sys.modules["app"].__path__ = [str(CHATKIT_MODULE_PATH.parent)]
sys.modules["app.chatkit"] = chatkit_module
assert chatkit_spec.loader is not None
chatkit_spec.loader.exec_module(chatkit_module)

CLIENT_TOOL_CALL_NAME_ANNOUNCE_GENERATED_IMAGE = (
    chatkit_module.CLIENT_TOOL_CALL_NAME_ANNOUNCE_GENERATED_IMAGE
)
_update_generated_image_client_tool_call = (
    chatkit_module._update_generated_image_client_tool_call
)

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "app" / "image_utils.py"
spec = importlib.util.spec_from_file_location("image_utils", MODULE_PATH)
image_utils = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(image_utils)

_SAMPLE_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


def _make_agent_context() -> SimpleNamespace:
    return SimpleNamespace(client_tool_call=None)


def test_save_agent_image_file_writes_png(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(image_utils, "AGENT_IMAGE_STORAGE_DIR", tmp_path)
    file_path, url = image_utils.save_agent_image_file("demo-doc", _SAMPLE_PNG_BASE64, output_format="png")

    assert file_path is not None
    assert url == f"{image_utils.AGENT_IMAGE_URL_PREFIX}/demo-doc.png"

    data = pathlib.Path(file_path).read_bytes()
    assert len(data) > 0


def test_save_agent_image_file_handles_invalid_base64(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(image_utils, "AGENT_IMAGE_STORAGE_DIR", tmp_path)
    file_path, url = image_utils.save_agent_image_file("demo-doc", "!!!", output_format="png")

    assert file_path is None
    assert url is None
    assert not any(tmp_path.iterdir())


def test_format_and_append_generated_image_links() -> None:
    urls = ["/api/chatkit/images/demo.png", " "]
    formatted = image_utils.format_generated_image_links(urls)

    assert formatted == "/api/chatkit/images/demo.png"

    appended = image_utils.append_generated_image_links("Bonjour", urls)
    assert appended == "Bonjour\n\n/api/chatkit/images/demo.png"

    appended_only = image_utils.append_generated_image_links("", urls)
    assert appended_only == formatted


def test_build_agent_image_absolute_url_with_token() -> None:
    absolute = image_utils.build_agent_image_absolute_url(
        "/api/chatkit/images/demo.png",
        base_url="https://example.test",
        token="tok en",
    )

    assert absolute.startswith("https://example.test/api/chatkit/images/demo.png")
    assert "token=tok%20en" in absolute


def test_merge_generated_image_urls_into_payload_with_mapping() -> None:
    payload = {"message": "bonjour"}
    merged = image_utils.merge_generated_image_urls_into_payload(
        payload,
        ["https://example.test/demo.png", ""],
    )

    assert merged is not payload
    assert merged["message"] == "bonjour"
    assert merged["generated_image_urls"] == ["https://example.test/demo.png"]


def test_merge_generated_image_urls_into_payload_with_string() -> None:
    merged = image_utils.merge_generated_image_urls_into_payload(
        "Bonjour",
        ["https://example.test/demo.png"],
    )

    assert "Bonjour" in merged
    assert "https://example.test/demo.png" in merged


def test_merge_generated_image_urls_into_payload_with_none() -> None:
    merged = image_utils.merge_generated_image_urls_into_payload(
        None,
        ["https://example.test/demo.png"],
    )

    assert merged == "https://example.test/demo.png"


def test_update_generated_image_client_tool_call_initializes_payload() -> None:
    context = _make_agent_context()
    metadata = {
        "call_id": "call-123",
        "output_index": 0,
        "step_slug": "draft-image",
        "step_title": "Génération d'image",
        "agent_key": "designer",
        "agent_label": "Designer",
    }
    record = {
        "local_file_url": "https://example.test/api/chatkit/images/1.png",
        "local_file_relative_url": "/api/chatkit/images/1.png",
    }

    _update_generated_image_client_tool_call(
        context,
        image_record=record,
        metadata=metadata,
    )

    call = context.client_tool_call
    assert call is not None
    assert call.name == CLIENT_TOOL_CALL_NAME_ANNOUNCE_GENERATED_IMAGE

    urls = call.arguments.get("urls")
    assert urls == ["https://example.test/api/chatkit/images/1.png"]

    images = call.arguments.get("images")
    assert isinstance(images, list)
    assert len(images) == 1
    first = images[0]
    assert first["url"] == "https://example.test/api/chatkit/images/1.png"
    assert first.get("relative_url") == "/api/chatkit/images/1.png"
    assert first.get("step_slug") == "draft-image"
    assert first.get("agent_key") == "designer"


def test_update_generated_image_client_tool_call_appends_unique_urls() -> None:
    context = _make_agent_context()
    metadata = {
        "call_id": "call-123",
        "output_index": 0,
    }
    record_primary = {
        "local_file_url": "https://example.test/api/chatkit/images/primary.png",
        "local_file_relative_url": "/api/chatkit/images/primary.png",
    }
    record_secondary = {
        "local_file_relative_url": "/api/chatkit/images/secondary.png",
    }

    _update_generated_image_client_tool_call(
        context,
        image_record=record_primary,
        metadata=metadata,
    )
    _update_generated_image_client_tool_call(
        context,
        image_record=record_secondary,
        metadata={**metadata, "output_index": 1},
    )
    _update_generated_image_client_tool_call(
        context,
        image_record=record_primary,
        metadata=metadata,
    )

    call = context.client_tool_call
    assert call is not None
    assert call.name == CLIENT_TOOL_CALL_NAME_ANNOUNCE_GENERATED_IMAGE

    urls = call.arguments.get("urls")
    assert isinstance(urls, list)
    assert urls == [
        "https://example.test/api/chatkit/images/primary.png",
        "/api/chatkit/images/secondary.png",
    ]

    images = call.arguments.get("images")
    assert isinstance(images, list)
    assert len(images) == 2
    assert images[0]["url"] == "https://example.test/api/chatkit/images/primary.png"
    assert images[1]["url"] == "/api/chatkit/images/secondary.png"
