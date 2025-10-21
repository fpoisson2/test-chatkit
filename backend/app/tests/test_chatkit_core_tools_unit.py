import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[3]))
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///")
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


from backend.app.chatkit_core.tools import (
    WebSearchTool,
    build_web_search_tool,
    sanitize_web_search_user_location,
)


def test_sanitize_web_search_user_location_discards_empty_values() -> None:
    payload = {"city": " Montréal ", "country": "", "region": "QC"}

    sanitized = sanitize_web_search_user_location(payload)

    assert sanitized == {"city": "Montréal", "region": "QC"}


def test_build_web_search_tool_from_dict() -> None:
    tool = build_web_search_tool(
        {"search_context_size": " high ", "user_location": {"city": "Paris"}}
    )

    assert isinstance(tool, WebSearchTool)
    if hasattr(tool, "search_context_size"):
        assert tool.search_context_size == "high"  # type: ignore[union-attr]
