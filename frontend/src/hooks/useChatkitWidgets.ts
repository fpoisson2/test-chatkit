import { useMemo } from "react";

export type VoiceSessionState = {
  startVoiceSession: () => void;
  stopVoiceSession: () => void;
  status: string;
  isListening: boolean;
  transcripts: unknown[];
  interruptSession: () => void;
  transportError: Error | null;
};

export type OutboundCallState = {
  callId: string | null;
  isActive: boolean;
  status: string;
  toNumber: string | null;
  transcripts: unknown[];
  error: Error | null;
  hangupCall: () => void;
};

export type UseChatkitWidgetsOptions = {
  hasVoiceAgent: boolean;
  hasOutboundCall: boolean;
  threadId: string | null;
  voiceSession: VoiceSessionState;
  outboundCall: OutboundCallState;
};

export type ChatkitWidgetsConfig = {
  voiceSession: {
    enabled: boolean;
    threadId: string | null;
    status: string;
    isListening: boolean;
    transcripts: unknown[];
    startVoiceSession: () => void;
    stopVoiceSession: () => void;
    interruptSession: () => void;
    transportError: Error | null;
  };
  outboundCall: {
    enabled: boolean;
    callId: string | null;
    isActive: boolean;
    status: string;
    toNumber: string | null;
    transcripts: unknown[];
    hangupCall: () => void;
    error: Error | null;
  };
};

export function useChatkitWidgets({
  hasVoiceAgent,
  hasOutboundCall,
  threadId,
  voiceSession,
  outboundCall,
}: UseChatkitWidgetsOptions): ChatkitWidgetsConfig {
  return useMemo(
    () => ({
      voiceSession: {
        enabled: hasVoiceAgent,
        threadId,
        status: voiceSession.status,
        isListening: voiceSession.isListening,
        transcripts: voiceSession.transcripts,
        startVoiceSession: voiceSession.startVoiceSession,
        stopVoiceSession: voiceSession.stopVoiceSession,
        interruptSession: voiceSession.interruptSession,
        transportError: voiceSession.transportError,
      },
      outboundCall: {
        enabled: hasOutboundCall,
        callId: outboundCall.callId,
        isActive: outboundCall.isActive,
        status: outboundCall.status,
        toNumber: outboundCall.toNumber,
        transcripts: outboundCall.transcripts,
        hangupCall: outboundCall.hangupCall,
        error: outboundCall.error,
      },
    }),
    [
      hasVoiceAgent,
      hasOutboundCall,
      threadId,
      voiceSession.status,
      voiceSession.isListening,
      voiceSession.transcripts,
      voiceSession.startVoiceSession,
      voiceSession.stopVoiceSession,
      voiceSession.interruptSession,
      voiceSession.transportError,
      outboundCall.callId,
      outboundCall.isActive,
      outboundCall.status,
      outboundCall.toNumber,
      outboundCall.transcripts,
      outboundCall.hangupCall,
      outboundCall.error,
    ],
  );
}
