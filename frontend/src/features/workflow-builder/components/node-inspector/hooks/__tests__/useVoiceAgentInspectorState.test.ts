import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICE_AGENT_MODEL,
  DEFAULT_VOICE_AGENT_VOICE,
  VOICE_AGENT_TOOL_KEYS,
  createVoiceAgentParameters,
  setAgentMessage,
  setAgentModel,
  setVoiceAgentStartBehavior,
  setVoiceAgentStopBehavior,
  setVoiceAgentToolEnabled,
  setVoiceAgentVoice,
} from "../../../../../../utils/workflows";
import { buildVoiceAgentInspectorState } from "../useVoiceAgentInspectorState";

describe("useVoiceAgentInspectorState", () => {
  it("returns defaults when parameters are empty", () => {
    const parameters = {};
    const state = buildVoiceAgentInspectorState(parameters);

    expect(state.voiceModel).toBe(DEFAULT_VOICE_AGENT_MODEL);
    expect(state.voiceId).toBe(DEFAULT_VOICE_AGENT_VOICE);
    expect(state.instructions).toBe("");
    expect(state.startBehavior).toBe("manual");
    expect(state.stopBehavior).toBe("auto");

    VOICE_AGENT_TOOL_KEYS.forEach((tool) => {
      expect(state.tools[tool]).toBeTypeOf("boolean");
    });
  });

  it("reflects custom realtime settings", () => {
    let parameters = createVoiceAgentParameters();
    parameters = setAgentModel(parameters, "gpt-4o-realtime-custom");
    parameters = setVoiceAgentVoice(parameters, "verse");
    parameters = setAgentMessage(parameters, "Stay concise");
    parameters = setVoiceAgentStartBehavior(parameters, "auto");
    parameters = setVoiceAgentStopBehavior(parameters, "manual");
    parameters = setVoiceAgentToolEnabled(parameters, "transcription", false);
    parameters = setVoiceAgentToolEnabled(parameters, "function_call", true);

    const state = buildVoiceAgentInspectorState(parameters);

    expect(state.voiceModel).toBe("gpt-4o-realtime-custom");
    expect(state.voiceId).toBe("verse");
    expect(state.instructions).toBe("Stay concise");
    expect(state.startBehavior).toBe("auto");
    expect(state.stopBehavior).toBe("manual");
    expect(state.tools.response).toBe(true);
    expect(state.tools.transcription).toBe(false);
    expect(state.tools.function_call).toBe(true);
  });
});
