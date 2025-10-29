import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { StartTelephonyWorkflowReference } from "../../../../../../utils/workflows";
import { StartInspectorSection } from "../StartInspectorSection";

type RenderOptions = Partial<Parameters<typeof StartInspectorSection>[0]>;

const defaultWorkflow: StartTelephonyWorkflowReference = { id: null, slug: "" };

const renderSection = (overrides: RenderOptions = {}) => {
  const onStartTelephonyWorkflowChange = vi.fn();
  const onStartTelephonyWorkflowToggle = vi.fn();

  render(
    <I18nProvider>
      <StartInspectorSection
        nodeId="start-node"
        startAutoRun={false}
        startAutoRunMessage=""
        startAutoRunAssistantMessage=""
        startTelephonyWorkflow={defaultWorkflow}
        startTelephonyEnabled={false}
        currentWorkflowSlug="support"
        currentWorkflowId={42}
        onStartAutoRunChange={vi.fn()}
        onStartAutoRunMessageChange={vi.fn()}
        onStartAutoRunAssistantMessageChange={vi.fn()}
        onStartTelephonyWorkflowChange={onStartTelephonyWorkflowChange}
        onStartTelephonyWorkflowToggle={onStartTelephonyWorkflowToggle}
        {...overrides}
      />
    </I18nProvider>,
  );

  return {
    onStartTelephonyWorkflowChange,
    onStartTelephonyWorkflowToggle,
  };
};

describe("StartInspectorSection", () => {
  it("active la téléphonie SIP et enregistre le workflow courant", async () => {
    const { onStartTelephonyWorkflowChange, onStartTelephonyWorkflowToggle } =
      renderSection();

    const toggle = screen.getByRole("switch", { name: /sip/i });
    await userEvent.click(toggle);

    expect(onStartTelephonyWorkflowToggle).toHaveBeenCalledWith("start-node", true);
    expect(onStartTelephonyWorkflowChange).toHaveBeenCalledWith("start-node", {
      slug: "support",
      id: 42,
    });
  });

  it("désactive la téléphonie SIP sans réécrire la configuration", async () => {
    const { onStartTelephonyWorkflowChange, onStartTelephonyWorkflowToggle } = renderSection({
      startTelephonyEnabled: true,
      startTelephonyWorkflow: { id: 42, slug: "support" },
    });

    const toggle = screen.getByRole("switch", { name: /sip/i });
    await userEvent.click(toggle);

    expect(onStartTelephonyWorkflowToggle).toHaveBeenCalledWith("start-node", false);
    expect(onStartTelephonyWorkflowChange).not.toHaveBeenCalled();
  });

  it("synchronise le slug lorsque le workflow change", () => {
    const { onStartTelephonyWorkflowChange } = renderSection({
      startTelephonyEnabled: true,
      startTelephonyWorkflow: { id: 42, slug: "legacy" },
      currentWorkflowSlug: "support",
    });

    expect(onStartTelephonyWorkflowChange).toHaveBeenCalledWith("start-node", {
      slug: "support",
      id: 42,
    });
  });

  it("désactive l'option SIP tant qu'aucun slug n'est défini", () => {
    renderSection({ currentWorkflowSlug: "" });

    const toggle = screen.getByRole("switch", { name: /sip/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/Set a workflow slug to enable SIP calls./i)).toBeInTheDocument();
  });
});
