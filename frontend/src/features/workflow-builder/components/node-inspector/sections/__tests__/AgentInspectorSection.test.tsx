import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { WorkflowSummary } from "../../../types";
import { AgentInspectorSection } from "../AgentInspectorSection";

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

const renderSection = (overrides: Partial<Parameters<typeof AgentInspectorSection>[0]> = {}) => {
  const onAgentNestedWorkflowChange = vi.fn();
  render(
    <I18nProvider>
      <AgentInspectorSection
        nodeId="agent-1"
        parameters={{}}
        token={null}
        workflows={baseWorkflows}
        currentWorkflowId={1}
        availableModels={[]}
        availableModelsLoading={false}
        availableModelsError={null}
        isReasoningModel={() => true}
        widgets={[]}
        widgetsLoading={false}
        widgetsError={null}
        vectorStores={[]}
        vectorStoresLoading={false}
        vectorStoresError={null}
        onAgentMessageChange={vi.fn()}
        onAgentModelChange={vi.fn()}
        onAgentProviderChange={vi.fn()}
        onAgentNestedWorkflowChange={onAgentNestedWorkflowChange}
        onAgentReasoningChange={vi.fn()}
        onAgentReasoningSummaryChange={vi.fn()}
        onAgentTextVerbosityChange={vi.fn()}
        onAgentTemperatureChange={vi.fn()}
        onAgentTopPChange={vi.fn()}
        onAgentMaxOutputTokensChange={vi.fn()}
        onAgentIncludeChatHistoryChange={vi.fn()}
        onAgentDisplayResponseInChatChange={vi.fn()}
        onAgentShowSearchSourcesChange={vi.fn()}
        onAgentContinueOnErrorChange={vi.fn()}
        onAgentStorePreferenceChange={vi.fn()}
        onAgentResponseFormatKindChange={vi.fn()}
        onAgentResponseFormatNameChange={vi.fn()}
        onAgentResponseFormatSchemaChange={vi.fn()}
        onAgentResponseWidgetSlugChange={vi.fn()}
        onAgentResponseWidgetSourceChange={vi.fn()}
        onAgentResponseWidgetDefinitionChange={vi.fn()}
        onAgentWebSearchChange={vi.fn()}
        onAgentFileSearchChange={vi.fn()}
        onAgentImageGenerationChange={vi.fn()}
        onAgentComputerUseChange={vi.fn()}
        onAgentMcpSseConfigChange={vi.fn()}
        onAgentWeatherToolChange={vi.fn()}
        onAgentWidgetValidationToolChange={vi.fn()}
        onAgentWorkflowValidationToolChange={vi.fn()}
        onAgentWorkflowToolToggle={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onAgentNestedWorkflowChange };
};

describe("AgentInspectorSection", () => {
  it("calls onAgentNestedWorkflowChange when selecting a workflow", async () => {
    const { onAgentNestedWorkflowChange } = renderSection();
    const select = screen.getByRole("combobox", { name: /workflow/i });
    await userEvent.selectOptions(select, "2");
    expect(onAgentNestedWorkflowChange).toHaveBeenLastCalledWith("agent-1", {
      mode: "local",
      workflowId: 2,
      workflowSlug: "secondary",
    });
  });

  it("shows slug information when configuration only specifies a slug", () => {
    renderSection({ parameters: { workflow: { slug: "external-workflow" } } });
    expect(
      screen.getByText(/Workflow selected via slug "external-workflow"\./i),
    ).toBeInTheDocument();
  });

  it("does not warn when a hosted workflow id is manually entered", () => {
    renderSection({ parameters: { workflow: { id: 99 } } });
    expect(
      screen.queryByText(/The selected workflow is no longer available\./i),
    ).not.toBeInTheDocument();
  });

  it("persists slug information when switching to a hosted workflow", async () => {
    const { onAgentNestedWorkflowChange } = renderSection({
      parameters: { workflow: { id: 2, slug: "secondary" } },
    });

    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThanOrEqual(2);
    const hostedRadio =
      radios.find((radio) => /hosted|hébergé/i.test(radio.parentElement?.textContent ?? "")) ??
      radios[1];
    await userEvent.click(hostedRadio);

    expect(onAgentNestedWorkflowChange).toHaveBeenLastCalledWith("agent-1", {
      mode: "hosted",
      workflowId: 2,
      workflowSlug: "secondary",
    });

    const hostedIdInput = screen.getByLabelText(/identifiant du workflow|workflow id/i);
    await userEvent.clear(hostedIdInput);
    await userEvent.type(hostedIdInput, "123");

    expect(onAgentNestedWorkflowChange).toHaveBeenLastCalledWith("agent-1", {
      mode: "hosted",
      workflowId: 123,
      workflowSlug: "secondary",
    });

    const hostedSlugInput = screen.getByLabelText(/slug du workflow|workflow slug/i);
    await userEvent.clear(hostedSlugInput);
    await userEvent.type(hostedSlugInput, "remote-workflow");

    expect(onAgentNestedWorkflowChange).toHaveBeenLastCalledWith("agent-1", {
      mode: "hosted",
      workflowId: 123,
      workflowSlug: "remote-workflow",
    });
  });

  it("calls onAgentWorkflowValidationToolChange when toggled", async () => {
    const onAgentWorkflowValidationToolChange = vi.fn();
    renderSection({ onAgentWorkflowValidationToolChange });

    const toggle = screen.getByRole("switch", {
      name: /Autoriser la fonction de validation de workflow/i,
    });

    await userEvent.click(toggle);

    expect(onAgentWorkflowValidationToolChange).toHaveBeenCalledWith("agent-1", true);
  });

  it("calls onAgentWorkflowToolToggle when enabling a workflow tool", async () => {
    const onAgentWorkflowToolToggle = vi.fn();
    renderSection({ onAgentWorkflowToolToggle });

    const toggle = screen.getByRole("switch", { name: "Secondary" });

    await userEvent.click(toggle);

    expect(onAgentWorkflowToolToggle).toHaveBeenCalledWith("agent-1", "secondary", true);
  });

  it("serializes the store flag in model options", () => {
    const availableModels = [
      {
        id: 1,
        name: "gpt-1",
        display_name: "GPT-1",
        description: null,
        provider_id: "openai",
        provider_slug: "openai",
        supports_reasoning: false,
        supports_previous_response_id: false,
        supports_reasoning_summary: false,
        store: false,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ];

    renderSection({ availableModels });

    const option = screen.getByRole("option", { name: /GPT-1/ }) as HTMLOptionElement;
    expect(option.value).toContain('"store":false');
  });

  it("disables the store toggle when the selected model forbids persistence", async () => {
    const onAgentStorePreferenceChange = vi.fn();
    const availableModels = [
      {
        id: 2,
        name: "privacy-model",
        display_name: "Privacy Model",
        description: null,
        provider_id: null,
        provider_slug: null,
        supports_reasoning: false,
        supports_previous_response_id: false,
        supports_reasoning_summary: false,
        store: false,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    ];

    renderSection({
      availableModels,
      parameters: {
        model: "privacy-model",
        model_settings: { store: false },
      },
      onAgentStorePreferenceChange,
    });

    const toggle = screen.getByRole("switch", {
      name: /Enregistrer la réponse dans l'historique de conversation/i,
    });

    expect(toggle).toBeDisabled();

    await userEvent.click(toggle);

    expect(onAgentStorePreferenceChange).not.toHaveBeenCalled();
  });
});
