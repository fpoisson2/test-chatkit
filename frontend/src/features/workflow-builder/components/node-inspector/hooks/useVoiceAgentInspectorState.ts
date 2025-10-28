import { useMemo } from "react";

import {
  DEFAULT_VOICE_AGENT_MODEL,
  DEFAULT_VOICE_AGENT_VOICE,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSCRIPTION_LANGUAGE,
  getAgentMessage,
  getAgentModel,
  getAgentModelProviderId,
  getAgentModelProviderSlug,
  getVoiceAgentStartBehavior,
  getVoiceAgentStopBehavior,
  getVoiceAgentTools,
  getVoiceAgentVoice,
  getTranscriptionModel,
  getTranscriptionLanguage,
  getTranscriptionPrompt,
} from "../../../../../utils/workflows";
import type {
  FlowNode,
  VoiceAgentTool,
  VoiceAgentStartBehavior,
  VoiceAgentStopBehavior,
} from "../../../types";

export type VoiceAgentInspectorState = {
  voiceModel: string;
  voiceProviderId: string;
  voiceProviderSlug: string;
  voiceId: string;
  instructions: string;
  startBehavior: VoiceAgentStartBehavior;
  stopBehavior: VoiceAgentStopBehavior;
  tools: Record<VoiceAgentTool, boolean>;
  transcriptionModel: string;
  transcriptionLanguage: string;
  transcriptionPrompt: string;
};

type UseVoiceAgentInspectorStateParams = {
  parameters: FlowNode["data"]["parameters"];
};

export const buildVoiceAgentInspectorState = (
  parameters: FlowNode["data"]["parameters"],
): VoiceAgentInspectorState => {
  const model = getAgentModel(parameters).trim() || DEFAULT_VOICE_AGENT_MODEL;
  const providerId = getAgentModelProviderId(parameters).trim();
  const providerSlug = getAgentModelProviderSlug(parameters).trim().toLowerCase();
  const instructions = getAgentMessage(parameters);
  const voice = getVoiceAgentVoice(parameters) || DEFAULT_VOICE_AGENT_VOICE;
  const startBehavior = getVoiceAgentStartBehavior(parameters);
  const stopBehavior = getVoiceAgentStopBehavior(parameters);
  const tools = getVoiceAgentTools(parameters);
  const transcriptionModel = getTranscriptionModel(parameters) || DEFAULT_TRANSCRIPTION_MODEL;
  const transcriptionLanguage = getTranscriptionLanguage(parameters) || DEFAULT_TRANSCRIPTION_LANGUAGE;
  const transcriptionPrompt = getTranscriptionPrompt(parameters);

  return {
    voiceModel: model,
    voiceProviderId: providerId,
    voiceProviderSlug: providerSlug,
    voiceId: voice,
    instructions,
    startBehavior,
    stopBehavior,
    tools,
    transcriptionModel,
    transcriptionLanguage,
    transcriptionPrompt,
  };
};

export const useVoiceAgentInspectorState = ({
  parameters,
}: UseVoiceAgentInspectorStateParams): VoiceAgentInspectorState =>
  useMemo(() => buildVoiceAgentInspectorState(parameters), [parameters]);
