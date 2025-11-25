/**
 * Types pour les fonctionnalités voix et appels ChatKit
 */

export type VoiceSessionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type TranscriptEntry = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status?: string;
  timestamp?: number;
};

export type OutboundCallStatus = 'idle' | 'queued' | 'initiating' | 'ringing' | 'answered' | 'completed' | 'failed' | 'busy' | 'no_answer';

export type OutboundCallTranscript = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number;
};
