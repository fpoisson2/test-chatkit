import React, { createContext, useContext, type ReactNode } from 'react';
import type { VoiceSessionStatus } from '../hooks/useWorkflowVoiceSession';

export interface VoiceSessionContextValue {
  status: VoiceSessionStatus;
  isListening: boolean;
  stopVoiceSession: () => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export interface VoiceSessionProviderProps {
  children: ReactNode;
  value: VoiceSessionContextValue;
}

export function VoiceSessionProvider({ children, value }: VoiceSessionProviderProps) {
  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSessionContext(): VoiceSessionContextValue | null {
  return useContext(VoiceSessionContext);
}
