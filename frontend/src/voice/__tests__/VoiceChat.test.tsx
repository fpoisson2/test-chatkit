import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { VoiceChat } from "../VoiceChat";

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
  const originalMediaDevices = navigator.mediaDevices;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  test("affiche un message lorsque l'accès micro est refusé", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("Permission refusée", "NotAllowedError"));

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<VoiceChat />);

    const startButton = screen.getByRole("button", { name: "Démarrer l'écoute" });
    fireEvent.click(startButton);

    expect(await screen.findByText("Permission microphone refusée.")).toBeInTheDocument();
    expect(startSessionMock).not.toHaveBeenCalled();
  });

  test("démarre la session voix lorsque le micro est autorisé", async () => {
    const stopMock = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopMock }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    startSessionMock.mockResolvedValue(undefined);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<VoiceChat />);

    const startButton = screen.getByRole("button", { name: "Démarrer l'écoute" });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(startSessionMock).toHaveBeenCalledWith({ preserveHistory: false, stream });
  });
});

