import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { WorkflowSummary } from "../../../types";
import { ToolSettingsPanel } from "../ToolSettingsPanel";

const baseWorkflows: WorkflowSummary[] = [
  {
    id: 1,
    slug: "main",
    display_name: "Main",
    description: null,
    active_version_id: 1,
    active_version_number: 1,
    is_chatkit_default: false,
    versions_count: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

const renderPanel = (
  overrides: Partial<Parameters<typeof ToolSettingsPanel>[0]> = {},
) => {
  const defaultProps: Parameters<typeof ToolSettingsPanel>[0] = {
    nodeId: "agent-1",
    parameters: {},
    workflows: baseWorkflows,
    currentWorkflowId: 1,
    onAgentWeatherToolChange: vi.fn(),
    onAgentWidgetValidationToolChange: vi.fn(),
    onAgentWorkflowValidationToolChange: vi.fn(),
    onAgentWorkflowToolToggle: vi.fn(),
    onAgentMcpSseConfigChange: vi.fn(),
    onTestMcpSseConnection: vi.fn().mockResolvedValue({ status: "ok" }),
    onStartMcpOAuth: vi.fn().mockResolvedValue({
      authorization_url: "https://auth.example/authorize",
      state: "state",
      expires_in: 300,
      redirect_uri: "https://example.com/callback",
    }),
    onPollMcpOAuth: vi.fn().mockResolvedValue({
      state: "state",
      status: "pending",
      expires_in: 300,
    }),
    onCancelMcpOAuth: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  render(
    <I18nProvider>
      <ToolSettingsPanel {...defaultProps} />
    </I18nProvider>,
  );

  return defaultProps;
};

const ensureMcpEnabled = async () => {
  const toggle = screen.getByRole("switch", { name: /serveur mcp|mcp server/i });
  if (toggle.getAttribute("aria-checked") === "false") {
    await userEvent.click(toggle);
  }
};

describe("ToolSettingsPanel", () => {
  it("propagates MCP configuration changes", async () => {
    const onAgentMcpSseConfigChange = vi.fn();
    renderPanel({ onAgentMcpSseConfigChange });

    await ensureMcpEnabled();
    const urlInput = screen.getByLabelText(/MCP server URL/i);
    await userEvent.type(urlInput, "https://ha.local/mcp");

    expect(onAgentMcpSseConfigChange).toHaveBeenLastCalledWith("agent-1", {
      url: "https://ha.local/mcp",
      authorization: "",
    });
  });

  it("tests the MCP connection and displays success feedback", async () => {
    const onTestMcpSseConnection = vi
      .fn()
      .mockResolvedValue({
        status: "ok",
        detail: "ok",
        tool_names: ["climate", "lights"],
      });

    renderPanel({
      parameters: {
        tools: [
          { type: "mcp", transport: "http_sse", url: "https://ha.local/mcp" },
        ],
      },
      onTestMcpSseConnection,
    });

    const button = screen.getByRole("button", { name: /Test connection/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(onTestMcpSseConnection).toHaveBeenCalledWith({
        url: "https://ha.local/mcp",
        authorization: "",
      });
    });

    expect(
      await screen.findByText(/Connection established\. 2 tool\(s\) available\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Available tools:/i).textContent,
    ).toContain("climate, lights");
  });

  it("shows validation feedback when the MCP URL is missing", async () => {
    renderPanel();

    await ensureMcpEnabled();
    const button = screen.getByRole("button", { name: /Test connection/i });
    await userEvent.click(button);

    expect(
      await screen.findByText(/Provide a valid MCP URL before running the test\./i),
    ).toBeInTheDocument();
  });

  it("renders server errors returned by the MCP test endpoint", async () => {
    const onTestMcpSseConnection = vi
      .fn()
      .mockResolvedValue({ status: "unauthorized" });

    renderPanel({
      parameters: {
        tools: [
          { type: "mcp", transport: "http_sse", url: "https://ha.local/mcp" },
        ],
      },
      onTestMcpSseConnection,
    });

    const button = screen.getByRole("button", { name: /Test connection/i });
    await userEvent.click(button);

    expect(
      await screen.findByText(/Authentication rejected by the MCP server\./i),
    ).toBeInTheDocument();
  });

  it("connects via OAuth and updates the authorization field", async () => {
    const onAgentMcpSseConfigChange = vi.fn();
    const onStartMcpOAuth = vi.fn().mockResolvedValue({
      authorization_url: "https://oauth.example/authorize",
      state: "state123",
      expires_in: 300,
      redirect_uri: "https://example.com/callback",
    });
    const onPollMcpOAuth = vi
      .fn()
      .mockResolvedValueOnce({
        state: "state123",
        status: "pending",
        expires_in: 200,
      })
      .mockResolvedValueOnce({
        state: "state123",
        status: "ok",
        expires_in: 180,
        token: { access_token: "abc123", token_type: "Bearer" },
      });
    const onCancelMcpOAuth = vi.fn().mockResolvedValue(undefined);

    const popup = { focus: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);

    try {
      renderPanel({
        onAgentMcpSseConfigChange,
        onStartMcpOAuth,
        onPollMcpOAuth,
        onCancelMcpOAuth,
      });

      await ensureMcpEnabled();
      const urlInput = screen.getByLabelText(/MCP server URL/i);
      await userEvent.type(urlInput, "https://ha.local/mcp");

      const oauthButton = screen.getByRole("button", { name: /Connect via OAuth/i });
      await userEvent.click(oauthButton);

      expect(onStartMcpOAuth).toHaveBeenCalledWith({
        url: "https://ha.local/mcp",
        clientId: null,
        scope: null,
      });
      expect(openSpy).toHaveBeenCalledWith(
        "https://oauth.example/authorize",
        "_blank",
        "noopener",
      );

      await waitFor(() => {
        expect(onPollMcpOAuth).toHaveBeenCalledWith("state123");
      });

      await waitFor(
        () => {
          expect(onPollMcpOAuth).toHaveBeenCalledTimes(2);
        },
        { timeout: 2000 },
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/Authorization/i)).toHaveValue(
          "Bearer abc123",
        );
      });

      expect(onAgentMcpSseConfigChange).toHaveBeenLastCalledWith("agent-1", {
        url: "https://ha.local/mcp",
        authorization: "Bearer abc123",
      });

      expect(onCancelMcpOAuth).toHaveBeenCalledWith("state123");

    } finally {
      openSpy.mockRestore();
    }
  });
});
