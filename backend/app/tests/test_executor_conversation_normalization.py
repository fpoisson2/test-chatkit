import os
import sys
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

CHATKIT_DIR = ROOT_DIR / "chatkit-python"
if str(CHATKIT_DIR) not in sys.path:
    sys.path.insert(0, str(CHATKIT_DIR))


os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from chatkit.types import (  # noqa: E402,I001
    AssistantMessageContent,
    AssistantMessageItem,
    InferenceOptions,
    UserMessageItem,
    UserMessageTextContent,
)


executor_module = import_module("backend.app.workflows.executor")


def test_normalize_conversation_history_for_groq_converts_text_blocks() -> None:
    items = [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Bonjour"}],
        },
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
        },
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert items[0]["content"][0]["type"] == "input_text"
    assert items[1]["content"][0]["type"] == "output_text"
    assert normalized[0]["content"][0]["type"] == "text"
    assert normalized[1]["content"][0]["type"] == "text"


def test_normalize_history_returns_same_sequence_for_other_providers() -> None:
    items = [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Bonjour"}],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "openai",
    )

    assert normalized is items


def test_normalize_conversation_history_for_groq_handles_pydantic_items() -> None:
    now = datetime.now(tz=timezone.utc)
    user_item = UserMessageItem(
        id="msg_1",
        thread_id="thread",
        created_at=now,
        content=[UserMessageTextContent(text="Salut")],
        attachments=[],
        inference_options=InferenceOptions(),
    )
    assistant_item = AssistantMessageItem(
        id="msg_2",
        thread_id="thread",
        created_at=now,
        content=[AssistantMessageContent(text="Bonjour")],
    )

    normalized = executor_module._normalize_conversation_history_for_provider(
        [user_item, assistant_item],
        "groq",
    )

    assert normalized[0] is not user_item
    assert normalized[1] is not assistant_item
    assert normalized[0]["content"][0]["type"] == "text"
    assert normalized[0]["content"][0]["text"] == "Salut"
    assert normalized[1]["content"][0]["type"] == "text"
    assert normalized[1]["content"][0]["text"] == "Bonjour"

    # Ensure original objects are left untouched
    assert user_item.content[0].type == "input_text"
    assert assistant_item.content[0].type == "output_text"
