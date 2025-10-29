import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import { StartInspectorSection } from "../StartInspectorSection";

type RenderOptions = Partial<Parameters<typeof StartInspectorSection>[0]>;

const renderSection = (overrides: RenderOptions = {}) => {
  const onStartTelephonyEntryPointChange = vi.fn();

  render(
    <I18nProvider>
      <StartInspectorSection
        nodeId="start-node"
        startAutoRun={false}
        startAutoRunMessage=""
        startAutoRunAssistantMessage=""
        startTelephonyEntryPoint={false}
        onStartAutoRunChange={vi.fn()}
        onStartAutoRunMessageChange={vi.fn()}
        onStartAutoRunAssistantMessageChange={vi.fn()}
        onStartTelephonyEntryPointChange={onStartTelephonyEntryPointChange}
        {...overrides}
      />
    </I18nProvider>,
  );

  return {
    onStartTelephonyEntryPointChange,
  };
};

describe("StartInspectorSection", () => {
  it("permet d'activer la téléphonie pour le workflow", async () => {
    const { onStartTelephonyEntryPointChange } = renderSection();

    const toggle = screen.getByRole("switch", { name: /incoming calls/i });
    await userEvent.click(toggle);

    expect(onStartTelephonyEntryPointChange).toHaveBeenCalledWith("start-node", true);
  });
});
