import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { AgentMcpToolConfig, AgentMcpToolValidation } from "../../../types";
import { ToolSettingsPanel } from "../ToolSettingsPanel";
import * as backendApi from "../../../../../../utils/backend";

const mockTestMcpConnection = vi.spyOn(backendApi, "testMcpConnection");
const mockCreateMcpCredential = vi.spyOn(backendApi, "createMcpCredential");
const mockStartMcpOAuth = vi.spyOn(backendApi, "startMcpOAuth");
const mockCompleteMcpOAuth = vi.spyOn(backendApi, "completeMcpOAuth");
const mockDeleteMcpCredential = vi.spyOn(backendApi, "deleteMcpCredential");

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
  credentialId: null,
  credentialLabel: "",
  credentialHint: "",
  credentialStatus: "disconnected",
  credentialAuthType: null,
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
    mockCreateMcpCredential.mockReset();
    mockStartMcpOAuth.mockReset();
    mockCompleteMcpOAuth.mockReset();
    mockDeleteMcpCredential.mockReset();
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

  it("prevents saving a credential when no API key is provided", async () => {
    renderPanel({
      authToken: "token-xyz",
      mcpTools: [{ ...baseConfig }],
    });

    const saveButton = screen.getByRole("button", { name: /save key/i });
    await userEvent.click(saveButton);

    expect(
      screen.getByText(/Enter an API key before saving it/i),
    ).toBeInTheDocument();
    expect(mockCreateMcpCredential).not.toHaveBeenCalled();
  });

  it("saves API key credentials and updates MCP tool metadata", async () => {
    const nowIso = new Date().toISOString();
    mockCreateMcpCredential.mockResolvedValueOnce({
      id: 42,
      label: "Docs",
      provider: null,
      auth_type: "api_key",
      secret_hint: "••••token",
      connected: true,
      created_at: nowIso,
      updated_at: nowIso,
    });

    const onAgentMcpToolsChange = vi.fn();

    renderPanel({
      authToken: "token-xyz",
      mcpTools: [
        {
          ...baseConfig,
          serverLabel: "Docs",
          authorization: "",
          credentialLabel: "",
        },
      ],
      onAgentMcpToolsChange,
    });

    const apiKeyInput = screen.getByPlaceholderText(
      /Paste the token to encrypt on the server/i,
    );
    await userEvent.type(apiKeyInput, "  secret-token  ");

    const saveButton = screen.getByRole("button", { name: /save key/i });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(mockCreateMcpCredential).toHaveBeenCalledWith({
        token: "token-xyz",
        payload: expect.objectContaining({
          label: "Docs",
          authType: "api_key",
          authorization: "secret-token",
        }),
      });
    });

    expect(onAgentMcpToolsChange).toHaveBeenCalledWith(
      "agent-1",
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: 42,
          credentialHint: "••••token",
          credentialStatus: "connected",
          credentialAuthType: "api_key",
        }),
      ]),
    );

    await waitFor(() => {
      expect(apiKeyInput).toHaveValue("");
    });
  });

  it("creates OAuth credentials, starts authorization, and opens a new window", async () => {
    const nowIso = new Date().toISOString();
    mockCreateMcpCredential.mockResolvedValueOnce({
      id: 77,
      label: "Voice",
      provider: null,
      auth_type: "oauth",
      secret_hint: "hint",
      connected: false,
      created_at: nowIso,
      updated_at: nowIso,
    });
    mockStartMcpOAuth.mockResolvedValueOnce({
      authorization_url: "https://auth.example.com/authorize", 
      state: "state-123",
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const onAgentMcpToolsChange = vi.fn();

    renderPanel({
      authToken: "token-oauth",
      mcpTools: [
        {
          ...baseConfig,
          serverLabel: "Voice",
          credentialLabel: "",
          credentialId: null,
          credentialStatus: "disconnected",
          credentialAuthType: null,
        },
      ],
      onAgentMcpToolsChange,
    });

    await userEvent.type(
      screen.getByPlaceholderText(/Authorization URL/i),
      "https://auth.example.com/oauth",
    );
    await userEvent.type(
      screen.getByPlaceholderText(/Token URL/i),
      "https://auth.example.com/token",
    );
    await userEvent.type(
      screen.getByPlaceholderText(/OAuth client ID/i),
      "client-abc",
    );
    await userEvent.type(
      screen.getByPlaceholderText(/Client secret/i),
      "top-secret",
    );
    await userEvent.type(
      screen.getByPlaceholderText(/Scopes separated/i),
      "tools.read, tools.write",
    );

    const startButton = screen.getByRole("button", { name: /start authorization/i });
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(mockCreateMcpCredential).toHaveBeenCalledWith({
        token: "token-oauth",
        payload: expect.objectContaining({
          authType: "oauth",
          oauth: expect.objectContaining({
            authorization_url: "https://auth.example.com/oauth",
            token_url: "https://auth.example.com/token",
            client_id: "client-abc",
            client_secret: "top-secret",
            scope: "tools.read, tools.write",
          }),
        }),
      });
    });

    await waitFor(() => {
      expect(mockStartMcpOAuth).toHaveBeenCalledWith({
        token: "token-oauth",
        credentialId: 77,
        redirectUri: `${window.location.origin}/mcp/oauth/callback`,
        scope: ["tools.read", "tools.write"],
      });
    });

    expect(openSpy).toHaveBeenCalledWith(
      "https://auth.example.com/authorize",
      "_blank",
      "noopener,noreferrer",
    );

    expect(onAgentMcpToolsChange).toHaveBeenCalledWith(
      "agent-1",
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: 77,
          credentialStatus: "pending",
          credentialAuthType: "oauth",
        }),
      ]),
    );

    openSpy.mockRestore();
  });

  it("completes OAuth flow for an existing credential", async () => {
    const nowIso = new Date().toISOString();
    mockStartMcpOAuth.mockResolvedValueOnce({
      authorization_url: "https://auth.example.com/authorize", 
      state: "state-xyz",
    });
    mockCompleteMcpOAuth.mockResolvedValueOnce({
      id: 88,
      label: "Voice",
      provider: null,
      auth_type: "oauth",
      secret_hint: "hint",
      connected: true,
      created_at: nowIso,
      updated_at: nowIso,
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const onAgentMcpToolsChange = vi.fn();

    renderPanel({
      authToken: "token-oauth",
      mcpTools: [
        {
          ...baseConfig,
          id: "mcp-2",
          serverLabel: "Voice",
          credentialId: 88,
          credentialStatus: "pending",
          credentialAuthType: "oauth",
        },
      ],
      onAgentMcpToolsChange,
    });

    await userEvent.type(
      screen.getByPlaceholderText(/Authorization URL/i),
      "https://auth.example.com/oauth",
    );
    await userEvent.type(
      screen.getByPlaceholderText(/Token URL/i),
      "https://auth.example.com/token",
    );
    await userEvent.type(
      screen.getByPlaceholderText(/OAuth client ID/i),
      "client-abc",
    );

    const startButton = screen.getByRole("button", { name: /start authorization/i });
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(mockCreateMcpCredential).not.toHaveBeenCalled();
      expect(mockStartMcpOAuth).toHaveBeenCalledWith({
        token: "token-oauth",
        credentialId: 88,
        redirectUri: `${window.location.origin}/mcp/oauth/callback`,
        scope: undefined,
      });
    });

    await userEvent.type(
      screen.getByPlaceholderText(/Authorization code/i),
      "auth-code-123",
    );

    const completeButton = screen.getByRole("button", { name: /validate code/i });
    await userEvent.click(completeButton);

    await waitFor(() => {
      expect(mockCompleteMcpOAuth).toHaveBeenCalledWith({
        token: "token-oauth",
        credentialId: 88,
        code: "auth-code-123",
        state: "state-xyz",
        redirectUri: `${window.location.origin}/mcp/oauth/callback`,
      });
    });

    expect(onAgentMcpToolsChange).toHaveBeenLastCalledWith(
      "agent-1",
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: 88,
          credentialStatus: "connected",
          credentialHint: "hint",
        }),
      ]),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Authorization code/i)).toHaveValue("");
    });

    openSpy.mockRestore();
  });

  it("deletes stored credentials", async () => {
    mockDeleteMcpCredential.mockResolvedValueOnce();
    const onAgentMcpToolsChange = vi.fn();

    renderPanel({
      authToken: "token-del",
      mcpTools: [
        {
          ...baseConfig,
          credentialId: 55,
          credentialStatus: "connected",
          credentialAuthType: "api_key",
        },
      ],
      onAgentMcpToolsChange,
    });

    const deleteButton = screen.getByRole("button", { name: /remove credentials/i });
    await userEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockDeleteMcpCredential).toHaveBeenCalledWith({
        token: "token-del",
        credentialId: 55,
      });
    });

    expect(onAgentMcpToolsChange).toHaveBeenCalledWith(
      "agent-1",
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: null,
          credentialStatus: "disconnected",
          credentialHint: "",
        }),
      ]),
    );
  });
});
