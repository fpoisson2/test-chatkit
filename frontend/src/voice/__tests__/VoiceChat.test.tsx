import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { VoiceChat } from "../VoiceChat";

if (!("navigator" in globalThis)) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {} as Navigator,
  });
}

const startSessionMock = vi.fn();
const stopSessionMock = vi.fn();
const clearErrorsMock = vi.fn();

vi.mock("../useVoiceSession", () => ({
  useVoiceSession: () => ({
    status: "idle" as const,
    isListening: false,
    transcripts: [],
    errors: [],
    webrtcError: null,
    startSession: startSessionMock,
    stopSession: stopSessionMock,
    clearErrors: clearErrorsMock,
  }),
}));

describe("VoiceChat", () => {
  const originalMediaDevices = globalThis.navigator.mediaDevices;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  test("affiche un message lorsque l'accès micro est refusé", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("Permission refusée", "NotAllowedError"));

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<VoiceChat />);

    const startButton = screen.getByRole("button", { name: "Démarrer l'écoute" });
    fireEvent.click(startButton);

    expect(await screen.findByText("Permission microphone refusée.")).toBeInTheDocument();
    expect(startSessionMock).not.toHaveBeenCalled();
  });
});

