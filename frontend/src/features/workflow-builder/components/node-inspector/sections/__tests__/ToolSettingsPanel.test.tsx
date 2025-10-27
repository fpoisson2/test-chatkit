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
    ...overrides,
  };

  render(
    <I18nProvider>
      <ToolSettingsPanel {...defaultProps} />
    </I18nProvider>,
  );

  return defaultProps;
};

describe("ToolSettingsPanel", () => {
  it("propagates MCP configuration changes", async () => {
    const onAgentMcpSseConfigChange = vi.fn();
    renderPanel({ onAgentMcpSseConfigChange });

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
});
