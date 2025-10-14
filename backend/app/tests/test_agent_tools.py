"""Tests liés à la conversion des outils Agents."""

from backend.app.chatkit import (
    FileSearchTool,
    WebSearchTool,
    _coerce_agent_tools,
    web_search_preview,
)


def test_coerce_agent_tools_from_serialized_web_search() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "web_search",
                "web_search": {
                    "search_context_size": "large",
                    "user_location": {
                        "city": "Montréal ",
                        "country": "",
                        "region": " QC",
                    },
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, WebSearchTool)
    if hasattr(tool, "search_context_size"):
        assert getattr(tool, "search_context_size") == "large"
    if hasattr(tool, "user_location") and tool.user_location is not None:
        assert tool.user_location.get("city") == "Montréal"
        assert "country" not in tool.user_location


def test_coerce_agent_tools_uses_fallback_on_unknown_entries() -> None:
    fallback = [web_search_preview]
    tools = _coerce_agent_tools([{"type": "unknown"}], fallback)

    assert isinstance(tools, list)
    assert tools is not fallback
    assert tools == fallback


def test_coerce_agent_tools_from_serialized_file_search() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "file_search",
                "file_search": {
                    "vector_store_slug": "plan-cadre",
                    "return_documents": "full",
                    "max_num_results": "10",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, FileSearchTool)
    assert tool.vector_store_ids == ["plan-cadre"]
    assert tool.include_search_results is True
    assert tool.max_num_results == 10


def test_coerce_agent_tools_accepts_empty_list() -> None:
    tools = _coerce_agent_tools([], [web_search_preview])
    assert isinstance(tools, list)
    assert tools == []


def test_coerce_agent_tools_returns_empty_when_no_fallback() -> None:
    tools = _coerce_agent_tools([{"type": "file_search"}])

    assert isinstance(tools, list)
    assert tools == []


def test_coerce_agent_tools_skips_file_search_without_slug() -> None:
    fallback = [web_search_preview]
    tools = _coerce_agent_tools(
        [
            {
                "type": "file_search",
                "file_search": {"return_documents": "full"},
            }
        ],
        fallback,
    )

    assert isinstance(tools, list)
    assert tools == fallback


def test_coerce_agent_tools_normalizes_none_value() -> None:
    tools = _coerce_agent_tools(None)

    assert isinstance(tools, list)
    assert tools == []
