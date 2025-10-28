import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockHandlers = {
  onConnectionChange?: (status: "connected" | "connecting" | "disconnected") => void;
  onTransportError?: (error: unknown) => void;
  onSessionCreated?: (event: { sessionId: string; threadId: string | null; session: object }) => void;
  onHistoryUpdated?: (sessionId: string, history: unknown[]) => void;
  onHistoryDelta?: (sessionId: string, item: unknown) => void;
  onAgentStart?: (sessionId: string) => void;
  onAgentEnd?: (sessionId: string) => void;
  onSessionFinalized?: (event: { sessionId: string; threadId: string | null; transcripts: unknown[] }) => void;
  onSessionError?: (sessionId: string, message: string) => void;
};

const realtimeHandlers: { current: MockHandlers | null } = { current: null };
const connectMock = vi.fn(async () => {});
const disconnectMock = vi.fn(() => {});
const sendAudioChunkMock = vi.fn(() => {});
const finalizeSessionMock = vi.fn(() => {});
const interruptSessionMock = vi.fn(() => {});
const getStatusMock = vi.fn(() => "connected");
const getGatewayUrlMock = vi.fn(() => null);
const getTokenMock = vi.fn(() => null);
const fetchSecretMock = vi.fn(async () => ({ client_secret: { value: "secret" } }));

let authToken: string | null = "test-token";

vi.mock("../../auth", () => ({
  __esModule: true,
  useAuth: () => ({ token: authToken }),
}));

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
      sendAudioChunk: sendAudioChunkMock,
      finalizeSession: finalizeSessionMock,
      interruptSession: interruptSessionMock,
      getStatus: getStatusMock,
      getGatewayUrl: getGatewayUrlMock,
      getToken: getTokenMock,
    };
  },
}));

const mockStop = vi.fn();

class MockMediaStreamTrack {
  stop = mockStop;
}

class MockMediaStream {
  getTracks() {
    return [new MockMediaStreamTrack() as unknown as MediaStreamTrack];
  }
}

let latestProcessor: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onaudioprocess: ((event: { inputBuffer: { getChannelData: (index: number) => Float32Array } }) => void) | null;
} | null = null;

let latestSource: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} | null = null;

class MockAudioContext {
  sampleRate = 48_000;
  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});

  createMediaStreamSource = vi.fn(() => {
    latestSource = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    return latestSource as unknown as MediaStreamAudioSourceNode;
  });

  createScriptProcessor = vi.fn(() => {
    latestProcessor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };
    return latestProcessor as unknown as ScriptProcessorNode;
  });
}

const originalAudioContext = window.AudioContext;

describe("useVoiceSession", () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    sendAudioChunkMock.mockClear();
    finalizeSessionMock.mockClear();
    interruptSessionMock.mockClear();
    fetchSecretMock.mockClear();
    realtimeHandlers.current = null;
    window.localStorage.clear();
    authToken = "test-token";
    mockStop.mockClear();
    latestProcessor = null;
    latestSource = null;
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: MockAudioContext,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: originalAudioContext,
    });
  });

  it("démarre une session et gère le flux Realtime", async () => {
    const { useVoiceSession } = await import("../useVoiceSession");

    const { result } = renderHook(() => useVoiceSession());

    const stream = new MockMediaStream() as unknown as MediaStream;

    await act(async () => {
      const startPromise = result.current.startSession({ preserveHistory: false, stream });
      realtimeHandlers.current?.onSessionCreated?.({
        sessionId: "session-1",
        threadId: null,
        session: {},
      });
      await startPromise;
    });

    expect(connectMock).toHaveBeenCalledWith({ token: "test-token" });
    expect(fetchSecretMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("connected");
    expect(result.current.isListening).toBe(true);

    const processor = latestProcessor;
    expect(processor).not.toBeNull();
    processor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.25, -0.25, 0.5, -0.5]),
      },
    });
    expect(sendAudioChunkMock).toHaveBeenCalled();

    act(() => {
      realtimeHandlers.current?.onHistoryUpdated?.("session-1", [
        {
          type: "message",
          itemId: "user-1",
          role: "user",
          status: "completed",
          content: [{ type: "input_text", text: "Bonjour" }],
        },
        {
          type: "message",
          itemId: "assistant-1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Salut" }],
        },
      ] as unknown[]);
    });

    expect(result.current.transcripts).toHaveLength(2);

    act(() => {
      result.current.stopSession();
    });

    expect(interruptSessionMock).toHaveBeenCalledWith("session-1");
    expect(mockStop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.isListening).toBe(false);
  });

  it("refuse le démarrage sans authentification", async () => {
    authToken = null;
    const { useVoiceSession } = await import("../useVoiceSession");
    const { result } = renderHook(() => useVoiceSession());

    const stream = new MockMediaStream() as unknown as MediaStream;

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.startSession({ preserveHistory: false, stream });
      } catch (error) {
        thrown = error;
      }
    });

    expect((thrown as Error).message).toBe("Authentification requise pour démarrer la session vocale.");
    expect(result.current.status).toBe("error");
    expect(result.current.transportError).toBe(
      "Authentification requise pour démarrer la session vocale.",
    );
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("enregistre les erreurs de transport", async () => {
    const { useVoiceSession } = await import("../useVoiceSession");
    const { result } = renderHook(() => useVoiceSession());

    const stream = new MockMediaStream() as unknown as MediaStream;

    await act(async () => {
      const startPromise = result.current.startSession({ preserveHistory: false, stream });
      realtimeHandlers.current?.onTransportError?.(new Error("Gateway down"));
      try {
        await startPromise;
      } catch {
        /* ignoré */
      }
    });

    expect(result.current.transportError).toBe("Gateway down");
    expect(result.current.errors).toHaveLength(1);
    expect(result.current.status).toBe("error");
  });
});

