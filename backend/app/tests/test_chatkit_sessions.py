import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
pytest.importorskip("starlette.responses")

from backend.app.chatkit_sessions import _sanitize_forward_headers


def test_sanitize_forward_headers_preserves_headers_without_authorization():
    headers = [("Content-Type", "application/json")]

    sanitized = _sanitize_forward_headers(headers, include_chatkit_beta=False)

    assert sanitized == [("Content-Type", "application/json")]


def test_sanitize_forward_headers_injects_authorization_when_missing():
    headers = [("Content-Type", "application/json")]

    sanitized = _sanitize_forward_headers(
        headers,
        include_chatkit_beta=False,
        authorization="Bearer test-token",
    )

    assert ("Authorization", "Bearer test-token") in sanitized
    # L'en-tête utilisateur ne doit pas apparaître car il n'existait pas.
    assert all(key.lower() != "authorization" or value == "Bearer test-token" for key, value in sanitized)


def test_sanitize_forward_headers_replaces_user_authorization():
    headers = [
        ("Authorization", "Bearer user-token"),
        ("X-Custom", "value"),
    ]

    sanitized = _sanitize_forward_headers(
        headers,
        include_chatkit_beta=False,
        authorization="Bearer server-token",
    )

    assert ("Authorization", "Bearer server-token") in sanitized
    assert all(value != "Bearer user-token" for key, value in sanitized if key.lower() == "authorization")
    assert ("X-Custom", "value") in sanitized
