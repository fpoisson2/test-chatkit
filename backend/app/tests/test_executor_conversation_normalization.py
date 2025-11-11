import os
import sys
from importlib import import_module
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


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
    assert normalized[0]["content"] == "Bonjour"
    assert normalized[1]["content"] == "Salut"


def test_normalize_conversation_history_for_litellm_converts_text_blocks() -> None:
    items = [
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "litellm",
    )

    assert normalized is not items
    assert normalized[0]["content"] == "Salut"


def test_normalize_conversation_history_for_litellm_with_multiple_text_parts() -> None:
    items = [
        {
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Salut"},
                {"type": "output_text", "text": "Comment ça va ?"},
            ],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "litellm",
    )

    assert normalized is not items
    assert normalized[0]["content"] == "Salut\n\nComment ça va ?"


def test_normalize_conversation_history_unchanged_for_other_providers() -> None:
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
