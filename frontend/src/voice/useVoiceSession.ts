import { useVoiceSessionController } from "./useVoiceSessionController";
import { useVoiceSecret } from "./useVoiceSecret";

export type {
  VoiceTranscript,
  VoiceSessionError,
  VoiceSessionStatus,
  UseVoiceSessionControllerResult as UseVoiceSessionResult,
} from "./useVoiceSessionController";

export const useVoiceSession = () => {
  const { fetchSecret } = useVoiceSecret();
  return useVoiceSessionController({ fetchSecret });
};

