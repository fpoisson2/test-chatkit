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
  const onStartTelephonySipServerChange = vi.fn();

  render(
    <I18nProvider>
      <StartInspectorSection
        nodeId="start-node"
        startAutoRun={false}
        startAutoRunMessage=""
        startAutoRunAssistantMessage=""
        startTelephonyRoutes={[]}
        startTelephonyWorkflow={defaultWorkflow}
        startTelephonySipServerId=""
        startTelephonyRealtime={defaultRealtime}
        onStartAutoRunChange={vi.fn()}
        onStartAutoRunMessageChange={vi.fn()}
        onStartAutoRunAssistantMessageChange={vi.fn()}
        onStartTelephonyRoutesChange={onStartTelephonyRoutesChange}
        onStartTelephonyWorkflowChange={onStartTelephonyWorkflowChange}
        onStartTelephonySipServerChange={onStartTelephonySipServerChange}
        onStartTelephonyRealtimeChange={onStartTelephonyRealtimeChange}
        sipServers={[
          {
            id: "primary",
            label: "Serveur primaire",
            trunk_uri: "sip:alice@example.com",
            username: "alice",
            contact_host: "198.51.100.5",
            contact_port: 5070,
            contact_transport: "udp",
            has_password: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]}
        sipServersLoading={false}
        sipServersError={null}
        {...overrides}
      />
    </I18nProvider>,
  );

  return {
    onStartTelephonyRoutesChange,
    onStartTelephonyWorkflowChange,
    onStartTelephonyRealtimeChange,
    onStartTelephonySipServerChange,
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

  it("masque les options avancées par défaut", () => {
    renderSection();

    expect(
      screen.queryByLabelText(/Target workflow slug|Slug du workflow/i),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Advanced telephony|Options avancées/i });
    expect(toggle).toBeInTheDocument();
  });

  it("propage les changements de configuration Realtime", async () => {
    const { onStartTelephonyRealtimeChange } = renderSection();

    const toggle = screen.getByRole("button", { name: /Advanced telephony|Options avancées/i });
    await userEvent.click(toggle);

    const select = screen.getByLabelText(/Start mode/i);
    await userEvent.selectOptions(select, "auto");

    expect(onStartTelephonyRealtimeChange).toHaveBeenCalledWith("start-node", {
      start_mode: "auto",
    });
  });

  it("propage le changement de serveur SIP", async () => {
    const { onStartTelephonySipServerChange } = renderSection();

    const input = screen.getByLabelText(/SIP server|Serveur SIP/i);
    await userEvent.clear(input);
    await userEvent.type(input, "primary");

    expect(onStartTelephonySipServerChange).toHaveBeenLastCalledWith(
      "start-node",
      "primary",
    );
  });
});
