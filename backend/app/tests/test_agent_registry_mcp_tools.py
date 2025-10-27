import pytest
from backend.app.chatkit.agent_registry import (
    _build_agent_kwargs,
    _coerce_agent_tools,
)

try:
    from agents.tool import HostedMCPTool
except ImportError:  # pragma: no cover - garde-fou
    HostedMCPTool = None  # type: ignore[assignment]

from agents.mcp.server import MCPServerStreamableHttp


@pytest.mark.skipif(HostedMCPTool is None, reason="Hosted MCP tool not available")
def test_coerce_agent_tools_with_hosted_mcp() -> None:
    entry = {
        "type": "mcp",
        "mcp": {
            "kind": "hosted",
            "label": "support",
            "server_url": "https://example.com/support",
        },
    }

    tools = _coerce_agent_tools([entry])

    assert isinstance(tools, list)
    assert len(tools) == 1
    assert isinstance(tools[0], HostedMCPTool)


def test_build_agent_kwargs_extracts_mcp_servers() -> None:
    entry = {
        "type": "mcp",
        "mcp": {
            "kind": "http",
            "label": "remote-http",
            "url": "https://example.com/mcp",
        },
    }

    tools = _coerce_agent_tools([entry])
    assert isinstance(tools, list)
    assert len(tools) == 1
    assert isinstance(tools[0], MCPServerStreamableHttp)

    kwargs = _build_agent_kwargs({"name": "demo"}, {"tools": tools})

    assert "mcp_servers" in kwargs
    assert kwargs["tools"] == []
    assert len(kwargs["mcp_servers"]) == 1
    assert isinstance(kwargs["mcp_servers"][0], MCPServerStreamableHttp)
