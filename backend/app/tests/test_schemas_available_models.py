from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test-available-models.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app.schemas import (  # noqa: E402
    AvailableModelCreateRequest,
    AvailableModelUpdateRequest,
)


def _base_payload(**overrides):
    payload = {
        "name": "gpt-4o-mini",
        "display_name": "GPT-4o Mini",
        "description": "Test model",
        "supports_reasoning": False,
        "supports_previous_response_id": True,
        "supports_reasoning_summary": True,
        "store": False,
    }
    payload.update(overrides)
    return payload


def test_available_model_allows_provider_slug_without_id() -> None:
    request = AvailableModelCreateRequest(**_base_payload(provider_slug="OpenAI"))

    assert request.provider_id is None
    assert request.provider_slug == "openai"


def test_available_model_rejects_provider_id_without_slug() -> None:
    with pytest.raises(ValidationError):
        AvailableModelCreateRequest(
            **_base_payload(provider_id="custom-provider", provider_slug=None)
        )


def test_available_model_rejects_store_true() -> None:
    with pytest.raises(ValidationError):
        AvailableModelCreateRequest(**_base_payload(store=True))


def test_available_model_update_normalizes_optional_fields() -> None:
    request = AvailableModelUpdateRequest(
        name="  gpt-4o-mini  ",
        display_name="  GPT-4o Mini  ",
        provider_slug="OpenAI",
        store=None,
    )

    assert request.name == "gpt-4o-mini"
    assert request.display_name == "GPT-4o Mini"
    assert request.provider_slug == "openai"
    assert request.store is None


def test_groq_model_disables_previous_response_id_on_create() -> None:
    """Groq models should have supports_previous_response_id=False automatically."""
    request = AvailableModelCreateRequest(
        **_base_payload(
            name="llama-3.3-70b-versatile",
            provider_slug="groq",
            supports_previous_response_id=True,  # Should be overridden
        )
    )

    assert request.provider_slug == "groq"
    assert request.supports_previous_response_id is False


def test_groq_model_disables_previous_response_id_on_update() -> None:
    """Groq models should have supports_previous_response_id=False on update."""
    request = AvailableModelUpdateRequest(
        provider_slug="groq",
        supports_previous_response_id=True,  # Should be overridden
    )

    assert request.provider_slug == "groq"
    assert request.supports_previous_response_id is False


def test_non_groq_model_allows_previous_response_id() -> None:
    """Non-Groq models should be able to have supports_previous_response_id=True."""
    request = AvailableModelCreateRequest(
        **_base_payload(
            provider_slug="openai",
            supports_previous_response_id=True,
        )
    )

    assert request.provider_slug == "openai"
    assert request.supports_previous_response_id is True
