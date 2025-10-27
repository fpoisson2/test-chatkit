import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockHandlers = {
  onHistoryUpdated?: (history: unknown[]) => void;
  onConnectionChange?: (status: "connected" | "connecting" | "disconnected") => void;
  onAgentStart?: () => void;
  onAgentEnd?: () => void;
  onTransportError?: (error: unknown) => void;
  onError?: (error: unknown) => void;
};

const realtimeHandlers: { current: MockHandlers | null } = { current: null };
const connectMock = vi.fn(async () => {});
const disconnectMock = vi.fn(() => {});

let authToken: string | null = "test-token";

vi.mock("../../auth", () => ({
  __esModule: true,
  useAuth: () => ({ token: authToken }),
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
    connectMock.mockReset();
    disconnectMock.mockReset();
    realtimeHandlers.current = null;
    window.localStorage.clear();
    authToken = "test-token";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("démarre une session et gère les transitions de statut", async () => {
    connectMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoiceSession());

    const stopMock = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: stopMock }],
    } as unknown as MediaStream;

    await act(async () => {
      await result.current.startSession({ preserveHistory: false, stream: mockStream });
    });

    expect(connectMock).toHaveBeenCalledWith({
      token: "test-token",
      localStream: mockStream,
    });
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
    const { result, unmount } = renderHook(() => useVoiceSession());

    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    await act(async () => {
      await result.current.startSession({ preserveHistory: false, stream: mockStream });
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

  it("passe en erreur lorsque l'authentification est absente", async () => {
    authToken = null;

    const { result } = renderHook(() => useVoiceSession());

    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.startSession({ preserveHistory: false, stream: mockStream });
      } catch (error) {
        thrown = error;
      }
    });

    expect((thrown as Error).message).toBe("Authentification requise pour démarrer la session vocale.");
    expect(result.current.status).toBe("error");
    expect(result.current.webrtcError).toBe(
      "Authentification requise pour démarrer la session vocale.",
    );
    expect(result.current.errors[0]?.message).toBe(
      "Authentification requise pour démarrer la session vocale.",
    );
    expect(connectMock).not.toHaveBeenCalled();
  });
});

