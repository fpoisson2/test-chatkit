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
