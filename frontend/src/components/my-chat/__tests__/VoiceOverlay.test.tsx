import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../i18n";
import { VoiceOverlay } from "../VoiceOverlay";

type VoiceOverlayProps = React.ComponentProps<typeof VoiceOverlay>;

const renderOverlay = (props?: Partial<VoiceOverlayProps>) => {
  const onStart = vi.fn();
  const onStop = vi.fn();
  const baseProps: VoiceOverlayProps = {
    visible: true,
    status: "idle",
    isListening: false,
    microPermission: "unknown",
    isRequestingMic: false,
    workflowTitle: "Étape voix",
    onStart,
    onStop,
    errorMessage: null,
    webrtcError: null,
    transcripts: [],
  };

  const result = render(
    <I18nProvider>
      <VoiceOverlay {...baseProps} {...props} onStart={props?.onStart ?? onStart} onStop={props?.onStop ?? onStop} />
    </I18nProvider>,
  );

  return { ...result, onStart, onStop };
};

describe("VoiceOverlay", () => {
  it("affiche les boutons de contrôle et le statut", () => {
    renderOverlay();

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: /(Transcriptions|Transcripts)/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /(Démarrer la voix|Start voice)/i }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: /(Arrêter|Stop)/i })).toBeDisabled();
  });

  it("désactive le bouton de démarrage lors de la demande micro", () => {
    renderOverlay({ isRequestingMic: true });

    expect(
      screen.getByRole("button", { name: /(Demande de permission|Requesting microphone)/i }),
    ).toBeDisabled();
  });

  it("déclenche le callback d'arrêt", () => {
    const { onStop } = renderOverlay({ status: "connected" });

    fireEvent.click(screen.getByRole("button", { name: /(Arrêter|Stop)/i }));
    expect(onStop).toHaveBeenCalled();
  });

  it("déclenche le callback de démarrage", () => {
    const { onStart } = renderOverlay({ status: "error" });

    fireEvent.click(screen.getByRole("button", { name: /(Démarrer la voix|Start voice)/i }));
    expect(onStart).toHaveBeenCalled();
  });
});
