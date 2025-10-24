import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { VoiceChat } from "../VoiceChat";

const startSessionMock = vi.fn();
const stopSessionMock = vi.fn();
const clearErrorsMock = vi.fn();
const requestPermissionMock = vi.fn(async () => {
  microphoneErrorValue = "Permission microphone refusée.";
  return false;
});
const resetMicrophoneErrorMock = vi.fn(() => {
  microphoneErrorValue = null;
});

let microphoneErrorValue: string | null = null;

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

vi.mock("../useMicrophoneAccess", () => ({
  useMicrophoneAccess: () => ({
    permission: "unknown" as const,
    error: microphoneErrorValue,
    isRequesting: false,
    requestPermission: requestPermissionMock,
    resetError: resetMicrophoneErrorMock,
  }),
}));

describe("VoiceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    microphoneErrorValue = null;
  });

  test("affiche un message lorsque l'accès micro est refusé", async () => {
    const { rerender } = render(<VoiceChat />);

    const startButton = screen.getByRole("button", { name: "Démarrer l'écoute" });
    fireEvent.click(startButton);

    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(startSessionMock).not.toHaveBeenCalled();

    rerender(<VoiceChat />);

    expect(await screen.findByText("Permission microphone refusée.")).toBeInTheDocument();
  });
});

