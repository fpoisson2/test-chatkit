import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { WorkflowSummary } from "../../../types";
import { ToolSettingsPanel } from "../ToolSettingsPanel";

vi.mock("../../../../../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const { listMock, createMock, probePersistedMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  probePersistedMock: vi.fn(),
}));

vi.mock("../../../../../../utils/backend", async () => {
  const actual = await vi.importActual<typeof import("../../../../../../utils/backend")>(
    "../../../../../../utils/backend",
  );
  return {
    ...actual,
    mcpServersApi: {
      ...actual.mcpServersApi,
      list: listMock,
      create: createMock,
      update: vi.fn(),
      delete: vi.fn(),
      probe: probePersistedMock,
    },
    probeMcpServer: probePersistedMock,
  };
});

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

const sampleServers = [
  {
    id: 1,
    label: "Alpha",
    server_url: "https://alpha.example.com",
    transport: "http_sse",
    is_active: true,
    oauth_client_id: null,
    oauth_scope: null,
    oauth_authorization_endpoint: null,
    oauth_token_endpoint: null,
    oauth_redirect_uri: null,
    oauth_metadata: null,
    authorization_hint: "****ALPHA",
    access_token_hint: null,
    refresh_token_hint: null,
    oauth_client_secret_hint: null,
    tools_cache: { tool_names: ["alpha-tool", "beta-tool"] },
    tools_cache_updated_at: "2024-01-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    label: "Beta",
    server_url: "https://beta.example.com",
    transport: "http_sse",
    is_active: true,
    oauth_client_id: null,
    oauth_scope: null,
    oauth_authorization_endpoint: null,
    oauth_token_endpoint: null,
    oauth_redirect_uri: null,
    oauth_metadata: null,
    authorization_hint: null,
    access_token_hint: null,
    refresh_token_hint: null,
    oauth_client_secret_hint: null,
    tools_cache: { tool_names: ["gamma-tool"] },
    tools_cache_updated_at: "2024-01-02T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  createMock.mockResolvedValue(sampleServers[0]);
  probePersistedMock.mockResolvedValue({ status: "ok", tool_names: [] });
});

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
    onAgentMcpServersChange: vi.fn(),
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

    await ensureMcpEnabled();
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

    await ensureMcpEnabled();
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
        expect(screen.getByLabelText(/Authorization/i)).toHaveValue("Bearer abc123");
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

  it("selects persisted MCP servers and updates allowlists", async () => {
    listMock.mockResolvedValue(sampleServers);
    const onAgentMcpServersChange = vi.fn();
    renderPanel({ onAgentMcpServersChange });

    const alphaCheckbox = await screen.findByLabelText(/Alpha/);
    await userEvent.click(alphaCheckbox);
    await waitFor(() => expect(onAgentMcpServersChange).toHaveBeenCalled());

    const betaCheckbox = screen.getByLabelText(/Beta/);
    await userEvent.click(betaCheckbox);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: [] },
        { serverId: 2, toolNames: [] },
      ]);
    });

    const alphaCard = alphaCheckbox.closest("label")?.parentElement;
    expect(alphaCard).not.toBeNull();
    const restrictToggle = within(alphaCard as HTMLElement).getByRole("switch", {
      name: /Limiter aux outils sélectionnés|Restrict to selected tools/i,
    });
    await userEvent.click(restrictToggle);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: ["alpha-tool", "beta-tool"] },
        { serverId: 2, toolNames: [] },
      ]);
    });

    const betaToolChip = within(alphaCard as HTMLElement).getByLabelText(/beta-tool/i);
    await userEvent.click(betaToolChip);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: ["alpha-tool"] },
        { serverId: 2, toolNames: [] },
      ]);
    });
  });

  it("manages manual allowlists and probes servers", async () => {
    listMock.mockResolvedValue(sampleServers);
    const onAgentMcpServersChange = vi.fn();
    renderPanel({ onAgentMcpServersChange });

    const alphaCheckbox = await screen.findByLabelText(/Alpha/);
    await userEvent.click(alphaCheckbox);
    await waitFor(() => expect(onAgentMcpServersChange).toHaveBeenCalled());

    const alphaCard = alphaCheckbox.closest("label")?.parentElement as HTMLElement;
    const input = within(alphaCard).getByPlaceholderText(/Nom d'outil|Tool name/i);
    await userEvent.type(input, "delta-tool");
    const addButton = within(alphaCard).getByRole("button", { name: /^(Ajouter|Add)$/i });
    await userEvent.click(addButton);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: ["delta-tool"] },
      ]);
    });

    probePersistedMock.mockResolvedValueOnce({
      status: "ok",
      detail: "ok",
      tool_names: ["alpha-tool"],
    });

    const probeButton = within(alphaCard).getByRole("button", {
      name: /Refresh tool cache|Rafraîchir le cache des outils/i,
    });
    await userEvent.click(probeButton);

    await waitFor(() => {
      expect(probePersistedMock).toHaveBeenCalledWith("test-token", {
        serverId: 1,
        url: "https://alpha.example.com",
      });
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("creates a new MCP server via the modal", async () => {
    const createdServer = {
      ...sampleServers[0],
      id: 3,
      label: "Gamma",
      server_url: "https://gamma.example.com",
    };
    listMock.mockResolvedValueOnce(sampleServers);
    listMock.mockResolvedValueOnce([...sampleServers, createdServer]);
    createMock.mockResolvedValue(createdServer);

    const onAgentMcpServersChange = vi.fn();
    renderPanel({ onAgentMcpServersChange });

    await screen.findByText(/Alpha/);
    await userEvent.click(
      screen.getByRole("button", {
        name: /Ajouter un serveur MCP|Add an MCP server/i,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText(/Libellé|Label/i),
      "Gamma",
    );
    await userEvent.type(
      within(dialog).getByLabelText(/URL du serveur MCP|MCP server URL/i),
      "https://gamma.example.com",
    );
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /Créer le serveur|Create server/i,
      }),
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({
          label: "Gamma",
          server_url: "https://gamma.example.com",
        }),
      );
    });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 3, toolNames: [] },
      ]);
    });
  });
});
