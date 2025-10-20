import importlib.util
import pathlib

import pytest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "app" / "image_utils.py"
spec = importlib.util.spec_from_file_location("image_utils", MODULE_PATH)
image_utils = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(image_utils)

_SAMPLE_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


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

    assert formatted.startswith("Images générées :")
    assert "demo.png" in formatted

    appended = image_utils.append_generated_image_links("Bonjour", urls)
    assert "Bonjour" in appended
    assert formatted in appended

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

    assert merged.startswith("Images générées :")
    assert "https://example.test/demo.png" in merged
