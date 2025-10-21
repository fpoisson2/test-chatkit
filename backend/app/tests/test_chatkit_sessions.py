import datetime

from backend.app.chatkit_sessions import (
    DEFAULT_SESSION_TTL,
    SessionSecretParser,
    summarize_payload_shape,
)


FIXED_NOW = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)


def test_parser_extracts_nested_secret_and_expiration() -> None:
    parser = SessionSecretParser(clock=lambda: FIXED_NOW)
    payload = {
        "session": {
            "client_secret": {"value": "nested-secret"},
            "expires_after": {"seconds": 180},
        }
    }

    result = parser.parse(payload)

    assert result.raw == {"value": "nested-secret"}
    assert result.as_text() == "nested-secret"
    expected_expiration = (FIXED_NOW + datetime.timedelta(seconds=180)).isoformat().replace("+00:00", "Z")
    assert result.expires_at_isoformat() == expected_expiration


def test_parser_handles_millisecond_durations() -> None:
    parser = SessionSecretParser(clock=lambda: FIXED_NOW)
    payload = {
        "client_secret": "quick-secret",
        "expires_after": {"milliseconds": 1500},
    }

    result = parser.parse(payload)

    assert result.as_text() == "quick-secret"
    expected_expiration = (FIXED_NOW + datetime.timedelta(milliseconds=1500)).isoformat().replace("+00:00", "Z")
    assert result.expires_at_isoformat() == expected_expiration


def test_parser_applies_default_ttl_when_missing_expiration() -> None:
    parser = SessionSecretParser(clock=lambda: FIXED_NOW)
    payload = {"client_secret": "timeless"}

    result = parser.parse(payload)

    assert result.as_text() == "timeless"
    expected_expiration = (FIXED_NOW + DEFAULT_SESSION_TTL).isoformat().replace("+00:00", "Z")
    assert result.expires_at_isoformat() == expected_expiration


def test_summarize_payload_shape_masks_sensitive_fields() -> None:
    payload = {
        "client_secret": "should-hide",
        "data": {"foo": 42, "bar": "baz"},
        "items": [1, 2, 3],
    }

    summary = summarize_payload_shape(payload)

    assert summary["client_secret"] == "***"
    assert summary["data"] == {"foo": "int", "bar": "str"}
    assert summary["items"] == "list(len=3)"
