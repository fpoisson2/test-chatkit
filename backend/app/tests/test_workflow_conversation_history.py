from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime
from importlib import import_module
from pathlib import Path

from chatkit.agents import ThreadItemConverter
from chatkit.types import (
    FileAttachment,
    InferenceOptions,
    UserMessageItem,
    UserMessageTextContent,
)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

import_module("backend.app.chatkit")
executor_module = import_module("backend.app.workflows.executor")
_build_user_message_history_items = executor_module._build_user_message_history_items


class DummyConverter(ThreadItemConverter):
    def __init__(self, output: list[object]) -> None:
        super().__init__()
        self._output = output
        self.calls: list[object] = []

    async def to_agent_input(self, thread_items):  # type: ignore[override]
        self.calls.append(thread_items)
        return list(self._output)


def test_build_user_history_items_includes_fallback_for_attachment_only() -> None:
    message = UserMessageItem(
        id="msg-attachment",
        thread_id="thr-1",
        created_at=datetime.now(),
        content=[],
        attachments=[
            FileAttachment(
                id="att-1",
                name="Recu.pdf",
                mime_type="application/pdf",
            )
        ],
        inference_options=InferenceOptions(),
    )
    converter = DummyConverter(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_file",
                        "file_data": "data:application/pdf;base64,ZmFrZQ==",
                        "filename": "Recu.pdf",
                    }
                ],
            }
        ]
    )
    fallback = "Attachment 1: Recu.pdf (file, application/pdf)"

    items = asyncio.run(
        _build_user_message_history_items(
            converter=converter,
            message=message,
            fallback_text=fallback,
        )
    )

    assert converter.calls and converter.calls[0] is message
    assert len(items) == 2
    assert items[0]["content"][0]["filename"] == "Recu.pdf"
    assert items[1]["content"][0]["text"] == fallback


def test_build_user_history_items_skips_fallback_when_text_present() -> None:
    message = UserMessageItem(
        id="msg-text",
        thread_id="thr-1",
        created_at=datetime.now(),
        content=[UserMessageTextContent(text="Bonjour")],
        attachments=[],
        inference_options=InferenceOptions(),
    )
    converter = DummyConverter(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Bonjour",
                    }
                ],
            }
        ]
    )

    items = asyncio.run(
        _build_user_message_history_items(
            converter=converter,
            message=message,
            fallback_text="Bonjour",
        )
    )

    assert len(items) == 1
    assert items[0]["content"][0]["text"] == "Bonjour"


def test_build_user_history_items_only_uses_fallback_when_converter_empty() -> None:
    message = UserMessageItem(
        id="msg-empty",
        thread_id="thr-1",
        created_at=datetime.now(),
        content=[],
        attachments=[],
        inference_options=InferenceOptions(),
    )
    converter = DummyConverter([])
    fallback = "Attachment 1: document.pdf (file, application/pdf)"

    items = asyncio.run(
        _build_user_message_history_items(
            converter=converter,
            message=message,
            fallback_text=fallback,
        )
    )

    assert len(items) == 1
    assert items[0]["content"][0]["text"] == fallback
