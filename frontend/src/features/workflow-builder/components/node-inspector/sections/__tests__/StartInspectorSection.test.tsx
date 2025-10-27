import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { StartTelephonyRealtimeOverrides, StartTelephonyWorkflowReference } from "../../../../../../utils/workflows";
import { StartInspectorSection } from "../StartInspectorSection";

type RenderOptions = Partial<Parameters<typeof StartInspectorSection>[0]>;

const defaultWorkflow: StartTelephonyWorkflowReference = { id: null, slug: "" };
const defaultRealtime: StartTelephonyRealtimeOverrides = {
  model: "",
  voice: "",
  start_mode: null,
  stop_mode: null,
};

const renderSection = (overrides: RenderOptions = {}) => {
  const onStartTelephonyRoutesChange = vi.fn();
  const onStartTelephonyWorkflowChange = vi.fn();
  const onStartTelephonyRealtimeChange = vi.fn();

  render(
    <I18nProvider>
      <StartInspectorSection
        nodeId="start-node"
        startAutoRun={false}
        startAutoRunMessage=""
        startAutoRunAssistantMessage=""
        startTelephonyRoutes={[]}
        startTelephonyWorkflow={defaultWorkflow}
        startTelephonyRealtime={defaultRealtime}
        onStartAutoRunChange={vi.fn()}
        onStartAutoRunMessageChange={vi.fn()}
        onStartAutoRunAssistantMessageChange={vi.fn()}
        onStartTelephonyRoutesChange={onStartTelephonyRoutesChange}
        onStartTelephonyWorkflowChange={onStartTelephonyWorkflowChange}
        onStartTelephonyRealtimeChange={onStartTelephonyRealtimeChange}
        {...overrides}
      />
    </I18nProvider>,
  );

  return {
    onStartTelephonyRoutesChange,
    onStartTelephonyWorkflowChange,
    onStartTelephonyRealtimeChange,
  };
};

describe("StartInspectorSection", () => {
  it("affiche une erreur pour les numéros non conformes", async () => {
    const { onStartTelephonyRoutesChange } = renderSection();

    const textarea = screen.getByLabelText(/Inbound numbers/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "abc");

    expect(onStartTelephonyRoutesChange).toHaveBeenCalledWith("start-node", ["abc"]);
    expect(await screen.findByText(/Invalid phone numbers:|Numéros non conformes/i)).toBeInTheDocument();
  });

  it("signale l'absence de slug lorsque des numéros sont configurés", () => {
    renderSection({ startTelephonyRoutes: ["+33123456789"], startTelephonyWorkflow: defaultWorkflow });

    expect(
      screen.getByText(/Provide a slug for the target workflow./i),
    ).toBeInTheDocument();
  });

  it("propage les changements de configuration Realtime", async () => {
    const { onStartTelephonyRealtimeChange } = renderSection();

    const select = screen.getByLabelText(/Start mode/i);
    await userEvent.selectOptions(select, "auto");

    expect(onStartTelephonyRealtimeChange).toHaveBeenCalledWith("start-node", {
      start_mode: "auto",
    });
  });
});
