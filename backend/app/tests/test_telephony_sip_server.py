from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from backend.app.telephony.sip_server import (  # noqa: E402
    TelephonyRouteSelectionError,
    resolve_workflow_for_phone_number,
)
from backend.app.workflows import resolve_start_telephony_config  # noqa: E402


@dataclass
class _Step:
    slug: str
    kind: str
    position: int
    is_enabled: bool
    parameters: dict[str, Any]


@dataclass
class _Definition:
    slug: str
    telephony_config: dict[str, Any]

    def __post_init__(self) -> None:
        start_step = _Step(
            slug="start",
            kind="start",
            position=0,
            is_enabled=True,
            parameters={"telephony": self.telephony_config},
        )
        self.steps = [start_step]
        self.workflow = SimpleNamespace(slug=self.slug)


class _FakeWorkflowService:
    def __init__(self, definitions: dict[str, _Definition], current: str) -> None:
        self._definitions = definitions
        self._current = current

    def get_current(self, session: Any | None = None) -> _Definition:
        return self._definitions[self._current]

    def get_definition_by_slug(
        self, slug: str, session: Any | None = None
    ) -> _Definition:
        return self._definitions[slug]


class _DummyVoiceSettings:
    def __init__(self) -> None:
        self.model = "base-model"
        self.instructions = "Base instructions"
        self.voice = "base-voice"
        self.prompt_variables = {"existing": "1"}


def test_resolve_start_telephony_config_parses_routes() -> None:
    definition = _Definition(
        slug="base",
        telephony_config={
            "routes": [
                {
                    "label": "Support",
                    "phone_numbers": [" +33 1 23 45 67 89 ", "001122"],
                    "workflow": {"slug": "support"},
                    "overrides": {
                        "model": "gpt-voice",
                        "voice": "alloy",
                        "instructions": "Soyez aimable",
                        "prompt_variables": {"locale": "fr", "trim": " value "},
                    },
                },
                {
                    "prefixes": ["+331"],
                    "workflow_slug": "sales",
                },
            ],
            "default": {
                "workflow": {"slug": "base"},
                "overrides": {"voice": "verse"},
            },
        },
    )

    config = resolve_start_telephony_config(definition)
    assert config is not None
    assert len(config.routes) == 2
    assert config.default_route is not None

    first_route = config.routes[0]
    assert first_route.workflow_slug == "support"
    assert first_route.phone_numbers == ("+33123456789", "001122")
    assert first_route.overrides.model == "gpt-voice"
    assert first_route.overrides.voice == "alloy"
    assert first_route.overrides.instructions == "Soyez aimable"
    assert first_route.overrides.prompt_variables == {"locale": "fr", "trim": " value "}

    second_route = config.routes[1]
    assert second_route.prefixes == ("+331",)


def test_resolve_workflow_for_phone_number_applies_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(
                slug="base",
                telephony_config={
                    "routes": [
                        {
                            "phone_numbers": ["+331234"],
                            "workflow": {"slug": "base"},
                            "overrides": {
                                "model": "gpt-special",
                                "voice": "ember",
                                "instructions": "Répondez rapidement",
                                "prompt_variables": {"channel": "sip"},
                            },
                        }
                    ],
                    "default": {
                        "workflow": {"slug": "base"},
                    },
                },
            )
        },
        current="base",
    )

    dummy_session = object()
    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="+33 1234",
        session=dummy_session,
    )

    assert context.route is not None
    assert context.voice_model == "gpt-special"
    assert context.voice_instructions == "Répondez rapidement"
    assert context.voice_voice == "ember"
    assert context.voice_prompt_variables == {"existing": "1", "channel": "sip"}


def test_resolve_workflow_for_phone_number_logs_and_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(slug="base", telephony_config={}),
        },
        current="base",
    )

    dummy_session = object()
    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    context = resolve_workflow_for_phone_number(
        service,
        phone_number="+331234",
        session=dummy_session,
    )

    assert context.route is None
    assert context.voice_model == "base-model"
    assert context.voice_voice == "base-voice"


def test_resolve_workflow_for_phone_number_raises_when_no_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeWorkflowService(
        definitions={
            "base": _Definition(
                slug="base",
                telephony_config={
                    "routes": [
                        {
                            "phone_numbers": ["+999"],
                            "workflow": {"slug": "base"},
                        }
                    ]
                },
            )
        },
        current="base",
    )

    monkeypatch.setattr(
        "backend.app.telephony.sip_server.get_or_create_voice_settings",
        lambda session: _DummyVoiceSettings(),
    )

    with pytest.raises(TelephonyRouteSelectionError):
        resolve_workflow_for_phone_number(
            service,
            phone_number="+331234",
            session=object(),
        )
