import { describe, expect, it } from "vitest";

import {
  extractVoiceSessionEvent,
  extractVoiceWaitState,
  normalizeToolPermissions,
  resolveVoiceStartMode,
  resolveVoiceStopMode,
  toWorkflowStartPayload,
} from "../voiceWorkflow";

const buildVoiceEvent = () => ({
  type: "voice_session.created" as const,
  step: { slug: "voice", title: "Voice" },
  client_secret: { value: "secret-123" },
  session: {
    model: "gpt-voice",
    voice: "alloy",
    instructions: "Parlez",
    realtime: { start_mode: "auto", stop_mode: "manual", tools: { response: true } },
    tool_definitions: [{ name: "ping" }],
  },
  tool_permissions: { response: true, transcription: "false", function_call: "1" },
});

describe("voiceWorkflow utils", () => {
  it("extrait un événement vocal depuis les logs", () => {
    const event = buildVoiceEvent();
    const logData = {
      item: {
        type: "task",
        task: { content: JSON.stringify(event) },
        thread_id: "thread-voice",
      },
    } as Record<string, unknown>;

    const extraction = extractVoiceSessionEvent(logData);
    expect(extraction).not.toBeNull();
    expect(extraction?.payload.type).toBe("voice_session.created");
    expect(extraction?.threadId).toBe("thread-voice");

    const payload = toWorkflowStartPayload(extraction!.payload);
    expect(payload.clientSecret).toEqual(event.client_secret);
    expect(payload.session).toEqual(event.session);
    expect(payload.toolPermissions).toEqual({ response: true, transcription: false, function_call: true });
  });

  it("normalise les permissions et les modes temps réel", () => {
    const permissions = normalizeToolPermissions({
      response: "true",
      transcription: "0",
      function_call: 1,
      unused: "maybe",
    });
    expect(permissions).toEqual({ response: true, transcription: false, function_call: true });

    const session = { realtime: { start_mode: "manual", stop_mode: "auto" } } as Parameters<
      typeof resolveVoiceStartMode
    >[0];
    expect(resolveVoiceStartMode(session)).toBe("manual");
    expect(resolveVoiceStopMode(session)).toBe("auto");
  });

  it("extrait l'état d'attente vocal lorsqu'il est présent", () => {
    const waitState = {
      type: "voice",
      slug: "voice",
    };
    const data = {
      thread: {
        metadata: {
          workflow_wait_for_user_input: waitState,
        },
      },
    } as Record<string, unknown>;

    expect(extractVoiceWaitState(data)).toEqual(waitState);
    expect(extractVoiceWaitState({ thread: { metadata: {} } } as Record<string, unknown>)).toBeNull();
  });
});
