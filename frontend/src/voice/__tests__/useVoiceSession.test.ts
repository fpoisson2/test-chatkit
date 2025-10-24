import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockHandlers = {
  onHistoryUpdated?: (history: unknown[]) => void;
  onConnectionChange?: (status: "connected" | "connecting" | "disconnected") => void;
  onAgentStart?: () => void;
  onAgentEnd?: () => void;
  onTransportError?: (error: unknown) => void;
  onError?: (error: unknown) => void;
  onRefreshDue?: () => void;
};

const fetchSecretMock = vi.fn();
const realtimeHandlers: { current: MockHandlers | null } = { current: null };
const connectMock = vi.fn(async () => {});
const disconnectMock = vi.fn(() => {});

vi.mock("../useVoiceSecret", () => ({
  __esModule: true,
  useVoiceSecret: () => ({ fetchSecret: fetchSecretMock }),
}));

vi.mock("../useRealtimeSession", () => ({
  __esModule: true,
  useRealtimeSession: (handlers: MockHandlers) => {
    realtimeHandlers.current = handlers;
    return {
      connect: connectMock,
      disconnect: disconnectMock,
    };
  },
}));

const { useVoiceSession } = await import("../useVoiceSession");

describe("useVoiceSession", () => {
  beforeEach(() => {
    fetchSecretMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    realtimeHandlers.current = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("démarre une session et gère les transitions de statut", async () => {
    const secret = {
      client_secret: "sk-test",
      instructions: "Parlez-moi",
      model: "gpt-voice",
      voice: "alloy",
    };
    fetchSecretMock.mockResolvedValue(secret);
    connectMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoiceSession());

    await act(async () => {
      await result.current.startSession();
    });

    const callArgs = connectMock.mock.calls[0]?.[0];
    expect(callArgs).toMatchObject({ apiKey: "sk-test", secret });
    expect(result.current.status).toBe("connected");
    expect(result.current.isListening).toBe(true);

    act(() => {
      realtimeHandlers.current?.onConnectionChange?.("connecting");
    });
    expect(result.current.status).toBe("connecting");

    act(() => {
      realtimeHandlers.current?.onConnectionChange?.("connected");
    });
    expect(result.current.status).toBe("connected");

    act(() => {
      realtimeHandlers.current?.onTransportError?.(new Error("ICE failure"));
    });
    expect(result.current.webrtcError).toBe("ICE failure");
    expect(result.current.errors).toHaveLength(1);

    act(() => {
      realtimeHandlers.current?.onConnectionChange?.("disconnected");
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.isListening).toBe(false);

    act(() => {
      result.current.stopSession();
    });
    expect(disconnectMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("idle");
  });

  it("met en cache l'historique dans le stockage local", async () => {
    const secret = {
      client_secret: "sk-test",
      instructions: "Parlez-moi",
      model: "gpt-voice",
      voice: "alloy",
    };
    fetchSecretMock.mockResolvedValue(secret);

    const { result, unmount } = renderHook(() => useVoiceSession());

    await act(async () => {
      await result.current.startSession();
    });

    act(() => {
      realtimeHandlers.current?.onHistoryUpdated?.([
        {
          type: "message",
          itemId: "msg-user",
          role: "user",
          status: "completed",
          content: [{ type: "input_text", text: "Bonjour" }],
        },
        {
          type: "message",
          itemId: "msg-assistant",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Salut" }],
        },
      ] as unknown[]);
    });

    expect(result.current.transcripts).toHaveLength(2);
    const stored = window.localStorage.getItem("chatkit:voice:history");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toHaveLength(2);

    unmount();

    const { result: rerenderResult, unmount: unmountRerender } = renderHook(() => useVoiceSession());
    expect(rerenderResult.current.transcripts).toHaveLength(2);
    expect(rerenderResult.current.transcripts[0].text).toBe("Bonjour");
    unmountRerender();
  });

  it("passe en erreur lorsque la récupération du secret échoue", async () => {
    fetchSecretMock.mockRejectedValue(new Error("Secret introuvable"));

    const { result } = renderHook(() => useVoiceSession());

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.startSession();
      } catch (error) {
        thrown = error;
      }
    });

    expect((thrown as Error).message).toBe("Secret introuvable");
    expect(result.current.status).toBe("error");
    expect(result.current.webrtcError).toBe("Secret introuvable");
    expect(result.current.errors[0]?.message).toBe("Secret introuvable");
    expect(connectMock).not.toHaveBeenCalled();
  });
});

