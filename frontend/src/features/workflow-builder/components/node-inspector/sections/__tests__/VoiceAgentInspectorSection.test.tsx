import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { WorkflowSummary } from "../../../types";
import { VoiceAgentInspectorSection } from "../VoiceAgentInspectorSection";

vi.mock("../../../../../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const { listMock, createMock, probeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  probeMock: vi.fn(),
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
    },
    probeMcpServer: probeMock,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  createMock.mockResolvedValue(null);
  probeMock.mockResolvedValue({ status: "ok", tool_names: [] });
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
  {
    id: 2,
    slug: "secondary",
    display_name: "Secondary",
    description: null,
    active_version_id: 2,
    active_version_number: 1,
    is_chatkit_default: false,
    versions_count: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

const renderSection = (overrides: Partial<Parameters<typeof VoiceAgentInspectorSection>[0]> = {}) => {
  const defaultProps: Parameters<typeof VoiceAgentInspectorSection>[0] = {
    nodeId: "voice-1",
    parameters: {},
    token: null,
    onAgentModelChange: vi.fn(),
    onAgentProviderChange: vi.fn(),
    onAgentMessageChange: vi.fn(),
    onVoiceAgentVoiceChange: vi.fn(),
    onVoiceAgentStartBehaviorChange: vi.fn(),
    onVoiceAgentStopBehaviorChange: vi.fn(),
    onVoiceAgentToolChange: vi.fn(),
    workflows: baseWorkflows,
    currentWorkflowId: 1,
    availableModels: [],
    availableModelsLoading: false,
    onAgentWeatherToolChange: vi.fn(),
    onAgentWidgetValidationToolChange: vi.fn(),
    onAgentWorkflowValidationToolChange: vi.fn(),
    onAgentWorkflowToolToggle: vi.fn(),
    onAgentMcpSseConfigChange: vi.fn(),
    onAgentMcpServersChange: vi.fn(),
    ...overrides,
  };

  render(
    <I18nProvider>
      <VoiceAgentInspectorSection {...defaultProps} />
    </I18nProvider>,
  );

  return defaultProps;
};

describe("VoiceAgentInspectorSection", () => {
  it("triggers onVoiceAgentToolChange when toggling a realtime tool", async () => {
    const onVoiceAgentToolChange = vi.fn();
    renderSection({ onVoiceAgentToolChange });

    const toggle = screen.getByRole("switch", {
      name: /Fonctions personnalisées|Function calling/i,
    });

    await userEvent.click(toggle);

    expect(onVoiceAgentToolChange).toHaveBeenCalledWith(
      "voice-1",
      "function_call",
      true,
    );
  });

  it("triggers onAgentWorkflowValidationToolChange when enabling the validation function", async () => {
    const onAgentWorkflowValidationToolChange = vi.fn();
    renderSection({ onAgentWorkflowValidationToolChange });

    const toggle = screen.getByRole("switch", {
      name: /Autoriser la fonction de validation de workflow/i,
    });

    await userEvent.click(toggle);

    expect(onAgentWorkflowValidationToolChange).toHaveBeenCalledWith("voice-1", true);
  });

  it("triggers onAgentWorkflowToolToggle when enabling a workflow tool", async () => {
    const onAgentWorkflowToolToggle = vi.fn();
    renderSection({ onAgentWorkflowToolToggle });

    const toggle = screen.getByRole("switch", { name: "Secondary" });

    await userEvent.click(toggle);

    expect(onAgentWorkflowToolToggle).toHaveBeenCalledWith("voice-1", "secondary", true);
  });

  it("allows selecting a provider", async () => {
    const onAgentProviderChange = vi.fn();
    const availableModels = [
      {
        id: 1,
        name: "gpt-voice",
        display_name: "GPT Voice",
        description: null,
        provider_id: null,
        provider_slug: "openai",
        supports_reasoning: false,
        supports_previous_response_id: true,
        supports_reasoning_summary: true,
        store: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ];

    renderSection({
      onAgentProviderChange,
      availableModels,
    });

    const select = screen.getByLabelText(/Fournisseur|Provider/i);
    await userEvent.selectOptions(select, [`|openai`]);

    expect(onAgentProviderChange).toHaveBeenCalledWith("voice-1", {
      providerId: null,
      providerSlug: "openai",
    });
  });
});

