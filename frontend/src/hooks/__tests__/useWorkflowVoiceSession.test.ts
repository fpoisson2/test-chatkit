import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceSessionSecret } from "../../voice/useVoiceSecret";

type MockHandlers = {
  onHistoryUpdated?: (history: unknown[]) => void;
  onConnectionChange?: (status: "connected" | "connecting" | "disconnected") => void;
  onAgentStart?: () => void;
  onAgentEnd?: () => void;
  onTransportError?: (error: unknown) => void;
  onError?: (error: unknown) => void;
  onRefreshDue?: () => void;
};

const connectMock = vi.fn(async () => {});
const disconnectMock = vi.fn(() => {});
const realtimeHandlers: { current: MockHandlers | null } = { current: null };

vi.mock("../../voice/useRealtimeSession", () => ({
  __esModule: true,
  useRealtimeSession: (handlers: MockHandlers) => {
    realtimeHandlers.current = handlers;
    return {
      connect: connectMock,
      disconnect: disconnectMock,
    };
  },
}));

const getTracksStub = () => [{ stop: vi.fn() }];
const getUserMediaMock = vi.fn(async () => ({ getTracks: getTracksStub }));

const originalMediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

const { useWorkflowVoiceSession } = await import("../useWorkflowVoiceSession");

describe("useWorkflowVoiceSession", () => {
  beforeEach(() => {
    connectMock.mockReset();
    disconnectMock.mockReset();
    realtimeHandlers.current = null;
    getUserMediaMock.mockClear();

    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: getUserMediaMock },
        configurable: true,
      });
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "mediaDevices", {
        value: originalMediaDevices,
        configurable: true,
      });
    }
  });

  it("connects when receiving a voice session task", async () => {
    const secret: VoiceSessionSecret = {
      client_secret: { value: "sk-workflow" },
      expires_at: null,
      instructions: "Parlez-moi",
      model: "gpt-voice",
      voice: "alloy",
    };

    const payload = {
      type: "voice_session.created",
      client_secret: secret,
      session: {
        realtime: { start_mode: "auto", stop_mode: "auto" },
      },
      tool_permissions: { transcription: true },
      step: { slug: "voice-step", title: "Étape vocale" },
    };

    const { result } = renderHook(() => useWorkflowVoiceSession());

    await act(async () => {
      await result.current.handleLogEvent({
        name: "workflow.task.created",
        data: {
          task: {
            metadata: { step_slug: "voice-step" },
            content: JSON.stringify(payload),
          },
        },
      });
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(connectMock).toHaveBeenCalledWith({ secret, apiKey: "sk-workflow" });
    expect(result.current.status).toBe("connected");
    expect(result.current.activeStepSlug).toBe("voice-step");

    act(() => {
      realtimeHandlers.current?.onHistoryUpdated?.([
        {
          type: "message",
          itemId: "msg-1",
          role: "user",
          status: "completed",
          content: [{ type: "input_text", text: "Bonjour" }],
        },
      ] as unknown[]);
    });

    expect(result.current.transcripts).toHaveLength(1);
    expect(result.current.transcripts[0]?.text).toBe("Bonjour");
  });

  it("connects when the voice task is nested in a thread item log", async () => {
    const secret: VoiceSessionSecret = {
      client_secret: { value: "sk-workflow" },
      expires_at: null,
      instructions: "Parlez-moi",
      model: "gpt-voice",
      voice: "alloy",
    };

    const payload = {
      type: "voice_session.created",
      client_secret: secret,
      tool_permissions: { response: true, transcription: true },
    };

    const { result } = renderHook(() => useWorkflowVoiceSession());

    await act(async () => {
      await result.current.handleLogEvent({
        name: "thread.item.created",
        data: {
          item: {
            type: "task",
            metadata: { step_slug: "voice-step" },
            task: {
              content: JSON.stringify(payload),
              metadata: { step_slug: "voice-step" },
            },
          },
        },
      });
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(connectMock).toHaveBeenCalledWith({ secret, apiKey: "sk-workflow" });
  });

  it("supports pre-parsed task content objects", async () => {
    const secret: VoiceSessionSecret = {
      client_secret: { value: "sk-workflow" },
      expires_at: null,
      instructions: "Parlez-moi",
      model: "gpt-voice",
      voice: "alloy",
    };

    const payload = {
      type: "voice_session.created",
      client_secret: secret,
    };

    const { result } = renderHook(() => useWorkflowVoiceSession());

    await act(async () => {
      await result.current.handleLogEvent({
        name: "workflow.task.created",
        data: {
          task: {
            metadata: { step_slug: "voice-step" },
            content: payload,
          },
        },
      });
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(connectMock).toHaveBeenCalledWith({ secret, apiKey: "sk-workflow" });
  });

  it("stops the realtime session when the workflow run finishes", async () => {
    const secret: VoiceSessionSecret = {
      client_secret: "sk-workflow",
      expires_at: null,
      instructions: "Parlez-moi",
      model: "gpt-voice",
      voice: "alloy",
    };

    const payload = {
      type: "voice_session.created",
      client_secret: secret,
    };

    const { result } = renderHook(() => useWorkflowVoiceSession());

    await act(async () => {
      await result.current.handleLogEvent({
        name: "workflow.task.created",
        data: {
          task: {
            metadata: { step_slug: "voice-step" },
            content: JSON.stringify(payload),
          },
        },
      });
    });

    connectMock.mockClear();
    disconnectMock.mockClear();

    await act(async () => {
      await result.current.handleLogEvent({
        name: "workflow.run.completed",
        data: { slug: "voice-step" },
      });
    });

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
  });
});
