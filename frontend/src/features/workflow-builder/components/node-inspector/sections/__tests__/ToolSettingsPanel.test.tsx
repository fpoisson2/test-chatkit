import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { AgentMcpToolConfig, AgentMcpToolValidation } from "../../../types";
import { ToolSettingsPanel } from "../ToolSettingsPanel";
import * as backendApi from "../../../../../../utils/backend";

const mockTestMcpConnection = vi.spyOn(backendApi, "testMcpConnection");

type PanelOverrides = Partial<Parameters<typeof ToolSettingsPanel>[0]>;

const baseConfig: AgentMcpToolConfig = {
  id: "mcp-1",
  transport: "hosted",
  serverLabel: "Server",
  serverUrl: "https://example.com",
  connectorId: "",
  authorization: "",
  headersText: "",
  allowedToolsText: "",
  requireApprovalMode: "never",
  requireApprovalCustom: "",
  description: "",
  url: "",
  command: "",
  argsText: "",
  envText: "",
  cwd: "",
};

const renderPanel = (overrides: PanelOverrides = {}) => {
  const defaultValidation: AgentMcpToolValidation[] = overrides.mcpValidation ?? [];
  const defaultTools: AgentMcpToolConfig[] = overrides.mcpTools ?? [];
  const authToken = overrides.authToken ?? null;

  const onAgentMcpToolsChange = overrides.onAgentMcpToolsChange ?? vi.fn();
  const onAgentWeatherToolChange = overrides.onAgentWeatherToolChange ?? vi.fn();
  const onAgentWidgetValidationToolChange =
    overrides.onAgentWidgetValidationToolChange ?? vi.fn();
  const onAgentWorkflowValidationToolChange =
    overrides.onAgentWorkflowValidationToolChange ?? vi.fn();
  const onAgentWorkflowToolToggle = overrides.onAgentWorkflowToolToggle ?? vi.fn();

  render(
    <I18nProvider>
      <ToolSettingsPanel
        nodeId="agent-1"
        authToken={authToken}
        parameters={overrides.parameters ?? {}}
        workflows={overrides.workflows ?? []}
        currentWorkflowId={overrides.currentWorkflowId ?? null}
        mcpTools={defaultTools}
        mcpValidation={defaultValidation}
        onAgentMcpToolsChange={onAgentMcpToolsChange}
        onAgentWeatherToolChange={onAgentWeatherToolChange}
        onAgentWidgetValidationToolChange={onAgentWidgetValidationToolChange}
        onAgentWorkflowValidationToolChange={onAgentWorkflowValidationToolChange}
        onAgentWorkflowToolToggle={onAgentWorkflowToolToggle}
      />
    </I18nProvider>,
  );

  return {
    onAgentMcpToolsChange,
    onAgentWeatherToolChange,
    onAgentWidgetValidationToolChange,
    onAgentWorkflowValidationToolChange,
    onAgentWorkflowToolToggle,
  };
};

describe("ToolSettingsPanel MCP configuration", () => {
  beforeEach(() => {
    mockTestMcpConnection.mockReset();
  });

  it("shows validation messages for hosted configuration", () => {
    renderPanel({
      mcpTools: [
        {
          ...baseConfig,
          serverLabel: "",
          serverUrl: "",
          connectorId: "",
        },
      ],
      mcpValidation: [
        {
          id: "mcp-1",
          errors: {
            serverLabel: "missing",
            connection: "missingTarget",
          },
        },
      ],
    });

    expect(
      screen.getByText(/Provide a label to identify this MCP server/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Provide the server URL or a connector identifier/i),
    ).toBeInTheDocument();
  });

  it("renders HTTP and SSE specific labels", () => {
    renderPanel({
      mcpTools: [
        { ...baseConfig, id: "mcp-http", transport: "http", url: "https://stream" },
        { ...baseConfig, id: "mcp-sse", transport: "sse", url: "https://events" },
      ],
      mcpValidation: [],
    });

    expect(screen.getByLabelText(/HTTP server URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/SSE server URL/i)).toBeInTheDocument();
  });

  it("normalizes pasted header values", async () => {
    const onAgentMcpToolsChange = vi.fn();
    renderPanel({
      mcpTools: [
        { ...baseConfig, id: "mcp-http", transport: "http", headersText: "" },
      ],
      mcpValidation: [],
      onAgentMcpToolsChange,
    });

    const headersField = screen.getByLabelText(/Additional HTTP headers/i);
    fireEvent.change(headersField, {
      target: { value: "Authorization: One\r\nX-Test: Two" },
    });

    expect(onAgentMcpToolsChange).toHaveBeenLastCalledWith(
      "agent-1",
      expect.arrayContaining([
        expect.objectContaining({
          headersText: "Authorization: One\nX-Test: Two",
        }),
      ]),
    );
  });

  it("renders stdio specific fields", () => {
    renderPanel({
      mcpTools: [
        {
          ...baseConfig,
          transport: "stdio",
          command: "./serve",
          argsText: "--port",
          envText: "TOKEN=abc",
          cwd: "/srv/app",
        },
      ],
      mcpValidation: [
        {
          id: "mcp-1",
          errors: {
            connection: "missingCommand",
            env: "invalid",
          },
        },
      ],
    });

    expect(screen.getByLabelText(/Command to execute/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Command arguments/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Environment variables/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Working directory/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Provide the command to execute/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Invalid format: use `key=value` on each line/i),
    ).toBeInTheDocument();
  });

  it("forwards weather toggle interactions", async () => {
    const { onAgentWeatherToolChange } = renderPanel({ parameters: {} });

    const toggle = screen.getByRole("switch", {
      name: /fonction météo python/i,
    });

    await userEvent.click(toggle);

    expect(onAgentWeatherToolChange).toHaveBeenCalledWith("agent-1", true);
  });

  it("tests MCP connection and surfaces success feedback", async () => {
    mockTestMcpConnection.mockResolvedValueOnce({
      ok: true,
      message: "Connexion établie",
    });

    renderPanel({ authToken: "token-123", mcpTools: [{ ...baseConfig }] });

    const button = screen.getByRole("button", {
      name: /tester la connexion|test connection/i,
    });

    await userEvent.click(button);

    await screen.findByText("Connexion établie");

    expect(mockTestMcpConnection).toHaveBeenCalledWith({
      token: "token-123",
      payload: expect.objectContaining({
        type: "mcp",
        mcp: expect.objectContaining({ kind: "hosted" }),
      }),
    });
  });

  it("shows an error message when the MCP connection fails", async () => {
    mockTestMcpConnection.mockResolvedValueOnce({
      ok: false,
      message: "Auth error",
    });

    renderPanel({ mcpTools: [{ ...baseConfig }] });

    const button = screen.getByRole("button", {
      name: /tester la connexion|test connection/i,
    });

    await userEvent.click(button);

    await screen.findByText("Auth error");
  });
});
