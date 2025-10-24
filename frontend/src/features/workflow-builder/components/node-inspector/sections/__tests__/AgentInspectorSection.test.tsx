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
        onAgentWeatherToolChange={vi.fn()}
        onAgentWidgetValidationToolChange={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onAgentNestedWorkflowChange };
};

describe("AgentInspectorSection", () => {
  it("calls onAgentNestedWorkflowChange when selecting a workflow", async () => {
    const { onAgentNestedWorkflowChange } = renderSection();
    const label = screen.getByText(/Nested workflow/i).closest("label");
    expect(label).not.toBeNull();
    const select = label?.querySelector("select");
    expect(select).not.toBeNull();
    await userEvent.selectOptions(select as HTMLSelectElement, "2");
    expect(onAgentNestedWorkflowChange).toHaveBeenCalledWith("agent-1", 2);
  });

  it("shows slug information when configuration only specifies a slug", () => {
    renderSection({ parameters: { workflow: { slug: "external-workflow" } } });
    expect(
      screen.getByText(/Workflow selected via slug "external-workflow"\./i),
    ).toBeInTheDocument();
  });

  it("warns when the selected workflow id is not available", () => {
    renderSection({ parameters: { workflow: { id: 99 } } });
    expect(
      screen.getByText(/The selected workflow is no longer available\./i),
    ).toBeInTheDocument();
  });
});
