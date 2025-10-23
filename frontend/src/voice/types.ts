import type { VoiceSessionSecret } from "./useVoiceSecret";

export type VoiceToolPermissions = Record<string, boolean>;

export type VoiceRealtimeSessionConfig = {
  model: string;
  voice: string;
  instructions: string;
  realtime?: {
    start_mode?: "manual" | "auto";
    stop_mode?: "manual" | "auto";
    tools?: VoiceToolPermissions;
  };
  tool_definitions?: unknown;
};

export type VoiceWorkflowStepInfo = {
  slug?: string | null;
  title?: string | null;
};

export type VoiceWorkflowStartPayload = {
  clientSecret: VoiceSessionSecret;
  session: VoiceRealtimeSessionConfig;
  step?: VoiceWorkflowStepInfo | null;
  toolPermissions: VoiceToolPermissions;
};
