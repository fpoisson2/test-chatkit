import pytest

from backend.app.token_sanitizer import sanitize_value


@pytest.mark.parametrize(
    "payload,expected,removed",
    [
        (
            {"reasoning": {"effort": "medium", "verbosity": "verbose", "summary": "auto"}},
            {"reasoning": {"effort": "medium", "summary": "auto"}},
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
