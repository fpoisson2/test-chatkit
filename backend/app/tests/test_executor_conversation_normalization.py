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


def test_normalize_does_not_touch_responses_messages() -> None:
    items = [
        {
            "type": "message",
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Bonjour"},
            ],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is items


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


def test_normalize_discards_non_text_parts_for_legacy_providers() -> None:
    items = [
        {
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Salut"},
                {"type": "image_file", "image": {"file_id": "img_1"}},
            ],
        }
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert normalized[0]["content"] == "Salut"
    # Original payload must remain untouched so it can be reused elsewhere.
    assert items[0]["content"][1]["type"] == "image_file"


def test_normalize_strips_invalid_ids_for_legacy_providers() -> None:
    items = [
        {"role": "assistant", "content": "Bonjour", "id": "__fake_id__"},
        {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
            "id": "another_fake",
        },
        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Coucou"}],
            "id": "msg_real_id",
        },
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "groq",
    )

    assert normalized is not items
    assert "id" not in normalized[0]
    assert "id" not in normalized[1]
    assert normalized[2]["id"] == "msg_real_id"


def test_normalize_retains_ids_for_responses_providers() -> None:
    items = [
        {"role": "assistant", "content": "Bonjour", "id": "__fake_id__"},
        {
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Salut"}],
            "id": "msg_real_id",
        },
    ]

    normalized = executor_module._normalize_conversation_history_for_provider(
        items,
        "openai",
    )

    assert normalized is items
    assert normalized[0]["id"] == "__fake_id__"
    assert normalized[1]["id"] == "msg_real_id"
    assert normalized[1]["content"] == [{"type": "output_text", "text": "Salut"}]


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


def test_deduplicate_conversation_history_items_removes_duplicate_ids() -> None:
    first = {"id": "rs_123", "role": "assistant"}
    duplicate = {"id": "rs_123", "role": "assistant", "content": []}
    items = [first, duplicate, {"id": "rs_456", "role": "user"}]

    deduplicated = executor_module._deduplicate_conversation_history_items(items)

    assert len(deduplicated) == 2
    assert first in deduplicated
    assert {"id": "rs_456", "role": "user"} in deduplicated


def test_deduplicate_conversation_history_items_returns_original_when_unique() -> None:
    items = [
        {"id": "rs_a", "role": "assistant"},
        {"id": "rs_b", "role": "user"},
    ]

    deduplicated = executor_module._deduplicate_conversation_history_items(items)

    assert deduplicated is items


def test_filter_conversation_history_for_previous_response_keeps_only_user_and_system() -> None:
    items = [
        {"id": "msg_a", "role": "assistant", "content": "hello"},
        {"id": "msg_b", "role": "user", "content": "hi"},
        {
            "id": "ig_123",
            "type": "image_generation_call",
            "reasoning": "rs_789",
            "role": "assistant",
        },
        {"id": "rs_789", "type": "reasoning", "role": "assistant"},
        {"id": "sys_1", "role": "system", "content": "instructions"},
    ]

    filtered = executor_module._filter_conversation_history_for_previous_response(items)

    assert filtered is not items
    assert filtered == [
        {"id": "msg_b", "role": "user", "content": "hi"},
        {"id": "sys_1", "role": "system", "content": "instructions"},
    ]


def test_sanitize_previous_response_id_returns_trimmed_valid_value() -> None:
    assert (
        executor_module._sanitize_previous_response_id("  resp-123 ")
        == "resp-123"
    )


def test_sanitize_previous_response_id_rejects_invalid_values() -> None:
    assert executor_module._sanitize_previous_response_id("__fake_id__") is None
    assert executor_module._sanitize_previous_response_id(123) is None
    assert executor_module._sanitize_previous_response_id(None) is None
