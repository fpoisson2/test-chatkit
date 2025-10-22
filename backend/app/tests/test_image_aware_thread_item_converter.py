from __future__ import annotations

import asyncio
import base64
import os
import sys
from importlib import import_module
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

ChatKitRequestContext = import_module(
    "backend.app.chatkit_server.context"
).ChatKitRequestContext
ImageAwareThreadItemConverter = import_module(
    "backend.app.chatkit_server.server"
).ImageAwareThreadItemConverter
FileAttachment = import_module("chatkit.types").FileAttachment


def test_image_attachment_converted_to_data_url(tmp_path: Path) -> None:
    payload = base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
    )
    image_path = tmp_path / "image.png"
    image_path.write_bytes(payload)

    async def opener(attachment_id: str, context: ChatKitRequestContext):
        return image_path, "image/png", "image.png"

    converter = ImageAwareThreadItemConverter(
        backend_public_base_url="https://public.test",
        open_attachment=opener,
    ).for_context(ChatKitRequestContext(user_id="user", email="user@example.test"))

    attachment = FileAttachment(id="att-1", name="photo.png", mime_type="image/png")

    result = asyncio.run(converter.attachment_to_message_content(attachment))

    assert result["type"] == "input_image"
    assert result["detail"] == "auto"
    assert result["image_url"].startswith("data:image/png;base64,")


def test_non_image_attachment_converted_to_file_param(tmp_path: Path) -> None:
    file_path = tmp_path / "document.pdf"
    file_path.write_bytes(b"%PDF-1.7 test content")

    async def opener(attachment_id: str, context: ChatKitRequestContext):
        return file_path, "application/pdf", "rapport.pdf"

    converter = ImageAwareThreadItemConverter(
        backend_public_base_url=None,
        open_attachment=opener,
    ).for_context(ChatKitRequestContext(user_id="user", email=None))

    attachment = FileAttachment(
        id="att-2",
        name="rapport.pdf",
        mime_type="application/pdf",
    )

    result = asyncio.run(converter.attachment_to_message_content(attachment))

    assert result["type"] == "input_file"
    assert result["filename"] == "rapport.pdf"
    assert result["file_data"].startswith("data:application/pdf;base64,")


def test_attachment_fallback_to_text_description() -> None:
    converter = ImageAwareThreadItemConverter(
        backend_public_base_url="https://public.test",
        open_attachment=None,
    ).for_context(ChatKitRequestContext(user_id="user", email=None))

    attachment = FileAttachment(id="att-3", name="notes.txt", mime_type="text/plain")

    result = asyncio.run(converter.attachment_to_message_content(attachment))

    assert result["type"] == "input_text"
    assert "notes.txt" in result["text"]
    assert "https://public.test/api/chatkit/attachments/att-3" in result["text"]
