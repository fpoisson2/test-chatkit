import copy

import pytest
from backend.app.token_sanitizer import sanitize_model_like, sanitize_value


@pytest.mark.parametrize(
    "payload,expected,removed",
    [
        (
            {
                "reasoning": {
                    "effort": "medium",
                    "verbosity": "verbose",
                    "summary": "auto",
                }
            },
            {
                "reasoning": {"effort": "medium", "summary": "auto"},
                "text": {"verbosity": "verbose"},
            },
            True,
        ),
        (
            {"reasoning": {"effort": "medium", "summary": "auto"}},
            {"reasoning": {"effort": "medium", "summary": "auto"}},
            False,
        ),
    ],
)
def test_sanitize_value_removes_unsupported_reasoning(payload, expected, removed):
    """Vérifie la suppression des champs de raisonnement non supportés."""

    sanitized, has_removed = sanitize_value(payload)
    assert sanitized == expected
    assert has_removed is removed


class _DummyModelSettings:
    """Réplique minimale d'un objet de configuration de modèle."""

    def __init__(self, **data: object) -> None:
        self._data = copy.deepcopy(data)
        for key, value in data.items():
            setattr(self, key, value)

    def model_dump(
        self, *, mode: str, exclude_none: bool, round_trip: bool
    ) -> dict[str, object]:  # noqa: D401
        """Imite l'API Pydantic en retournant une copie profonde."""

        return copy.deepcopy(self._data)

    @classmethod
    def model_validate(cls, data: dict[str, object]) -> "_DummyModelSettings":
        return cls(**data)


def test_sanitize_model_like_removes_reasoning_verbosity():
    """Vérifie le nettoyage du champ reasoning.verbosity dans les modèles."""

    settings = _DummyModelSettings(
        reasoning={"effort": "medium", "verbosity": "verbose", "summary": "auto"}
    )

    sanitized = sanitize_model_like(settings)

    assert sanitized is not settings
    assert sanitized.reasoning == {"effort": "medium", "summary": "auto"}
    assert sanitized.text == {"verbosity": "verbose"}


def test_sanitize_model_like_returns_original_when_unchanged():
    """Confirme qu'aucun objet n'est dupliqué lorsque rien n'est supprimé."""

    settings = _DummyModelSettings(
        reasoning={"effort": "medium", "summary": "auto"},
        other="value",
    )

    sanitized = sanitize_model_like(settings)

    assert sanitized is settings


def test_sanitize_value_keeps_text_verbosity():
    """S'assure que la verbosité textuelle reste transmise."""

    payload = {"text": {"verbosity": "low"}}

    sanitized, removed = sanitize_value(payload)

    assert sanitized == payload
    assert removed is False


def test_sanitize_value_preserves_existing_text_verbosity():
    """Ne remplace pas une verbosité textuelle déjà définie."""

    payload = {
        "text": {"verbosity": "low"},
        "reasoning": {"effort": "medium", "verbosity": "high"},
    }

    sanitized, removed = sanitize_value(payload)

    assert sanitized == {
        "text": {"verbosity": "low"},
        "reasoning": {"effort": "medium"},
    }
    assert removed is True


def test_sanitize_value_ignores_non_string_reasoning_verbosity():
    """Ignore les valeurs non textuelles lors du report dans text."""

    payload = {"reasoning": {"verbosity": 42}}

    sanitized, removed = sanitize_value(payload)

    assert sanitized == {}
    assert removed is True
