"""Tests pour l'extraction de texte utilisateur dans le contexte ChatKit."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

context_module = import_module("backend.app.chatkit_server.context")
types_module = import_module("chatkit.types")

FileAttachment = types_module.FileAttachment
InferenceOptions = types_module.InferenceOptions
UserMessageItem = types_module.UserMessageItem
UserMessageTextContent = types_module.UserMessageTextContent


def _build_user_message(**overrides):
    base = {
        "id": "msg-1",
        "thread_id": "thr-1",
        "created_at": datetime.now(timezone.utc),
        "content": [],
        "attachments": [],
        "inference_options": InferenceOptions(),
    }
    base.update(overrides)
    return UserMessageItem(**base)


def test_collect_user_text_prefers_normalized_text() -> None:
    message = _build_user_message(
        content=[UserMessageTextContent(text="  Bonjour \u200bmonde  ")],
        attachments=[
            FileAttachment(
                id="att-1",
                name="Recu.pdf",
                mime_type="application/pdf",
            )
        ],
    )

    result = context_module._collect_user_text(message)

    assert result == "Bonjour monde"


def test_collect_user_text_falls_back_to_attachments() -> None:
    message = _build_user_message(
        attachments=[
            FileAttachment(
                id="att-1",
                name="Recu.pdf",
                mime_type="application/pdf",
            ),
            FileAttachment(
                id="att-2",
                name="Justificatif.png",
                mime_type="image/png",
            ),
        ]
    )

    result = context_module._collect_user_text(message)

    assert "Attachment 1" in result
    assert "Recu.pdf" in result
    assert "application/pdf" in result
    assert "Attachment 2" in result
    assert "Justificatif.png" in result
    assert "image/png" in result


def test_resolve_user_input_text_uses_attachment_history() -> None:
    history_message = _build_user_message(
        attachments=[
            FileAttachment(
                id="att-3",
                name="facture-janvier.pdf",
                mime_type="application/pdf",
            )
        ]
    )

    result = context_module._resolve_user_input_text(None, [history_message])

    assert "Attachment 1" in result
    assert "facture-janvier.pdf" in result
    assert "application/pdf" in result
