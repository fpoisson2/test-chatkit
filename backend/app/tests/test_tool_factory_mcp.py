import pytest
from backend.app.tool_factory import build_mcp_tool

try:
    from agents.tool import HostedMCPTool
except ImportError:  # pragma: no cover - garde-fou
    HostedMCPTool = None  # type: ignore[assignment]

from agents.mcp.server import (
    MCPServerSse,
    MCPServerStdio,
    MCPServerStreamableHttp,
)


@pytest.mark.skipif(HostedMCPTool is None, reason="Hosted MCP tool not available")
def test_build_mcp_tool_hosted_configuration() -> None:
    payload = {
        "type": "mcp",
        "mcp": {
            "kind": "hosted",
            "label": "docs",
            "server_url": "https://example.org/mcp",
            "authorization": "token",
            "headers": {"X-Test": "ok"},
        },
    }

    tool = build_mcp_tool(payload, raise_on_error=True)

    assert isinstance(tool, HostedMCPTool)
    assert tool.tool_config["server_label"] == "docs"
    assert tool.tool_config["server_url"] == "https://example.org/mcp"
    assert tool.tool_config["headers"] == {"X-Test": "ok"}


def test_build_mcp_tool_http_configuration() -> None:
    payload = {
        "type": "mcp",
        "mcp": {
            "kind": "http",
            "label": "remote-http",
            "url": "https://example.net/mcp",
            "headers": {"X-Auth": "demo"},
            "cache_tools_list": True,
            "client_session_timeout_seconds": 12,
            "use_structured_content": True,
            "max_retry_attempts": 2,
            "retry_backoff_seconds_base": 1.5,
            "timeout": 6,
            "sse_read_timeout": 8,
            "terminate_on_close": False,
        },
    }

    server = build_mcp_tool(payload, raise_on_error=True)

    assert isinstance(server, MCPServerStreamableHttp)
    assert server.params["url"] == "https://example.net/mcp"
    assert server.params["headers"] == {"X-Auth": "demo"}
    assert server.cache_tools_list is True
    assert server.client_session_timeout_seconds == 12
    assert server.use_structured_content is True
    assert server.max_retry_attempts == 2
    assert server.retry_backoff_seconds_base == 1.5
    assert server.session is None


def test_build_mcp_tool_sse_configuration() -> None:
    payload = {
        "type": "mcp",
        "mcp": {
            "kind": "sse",
            "label": "remote-sse",
            "url": "https://example.com/sse",
            "timeout": "5",
            "sse_read_timeout": "9",
        },
    }

    server = build_mcp_tool(payload, raise_on_error=True)

    assert isinstance(server, MCPServerSse)
    assert server.params["url"] == "https://example.com/sse"
    assert server.params["timeout"] == 5.0
    assert server.params["sse_read_timeout"] == 9.0
    assert server.session is None


def test_build_mcp_tool_stdio_configuration() -> None:
    payload = {
        "type": "mcp",
        "mcp": {
            "kind": "stdio",
            "label": "local",
            "command": "/usr/bin/env",
            "args": ["python", "-m", "tool"],
            "env": {"FOO": "BAR"},
            "cwd": "/tmp",
            "encoding": "utf-8",
            "encoding_error_handler": "ignore",
        },
    }

    server = build_mcp_tool(payload, raise_on_error=True)

    assert isinstance(server, MCPServerStdio)
    assert server.params.command == "/usr/bin/env"
    assert list(server.params.args) == ["python", "-m", "tool"]
    assert server.params.env == {"FOO": "BAR"}
    assert server.params.cwd == "/tmp"
    assert server.params.encoding == "utf-8"
    assert server.params.encoding_error_handler == "ignore"
    assert server.session is None


def test_build_mcp_tool_invalid_hosted_configuration_raises() -> None:
    payload = {
        "type": "mcp",
        "mcp": {
            "kind": "hosted",
            "server_url": "https://example.org/mcp",
        },
    }

    with pytest.raises(ValueError) as exc_info:
        build_mcp_tool(payload, raise_on_error=True)

    assert "server_label" in str(exc_info.value)
