import { useMemo } from 'react';
import type {
  ChatKitOptions,
  VoiceSessionWidget,
  OutboundCallWidget,
} from '../types';

export interface UseInlineWidgetsOptions {
  threadId: string | undefined;
  widgets?: ChatKitOptions['widgets'];
}

export interface UseInlineWidgetsReturn {
  inlineVoiceWidget: VoiceSessionWidget | null;
  inlineOutboundCallWidget: OutboundCallWidget | null;
}

/**
 * Hook to compute inline voice and outbound call widgets based on current state.
 */
export function useInlineWidgets({
  threadId,
  widgets,
}: UseInlineWidgetsOptions): UseInlineWidgetsReturn {
  const inlineVoiceWidget = useMemo<VoiceSessionWidget | null>(() => {
    const voiceSession = widgets?.voiceSession;
    if (!voiceSession || voiceSession.enabled === false) {
      return null;
    }

    const voiceThreadMatches = !voiceSession.threadId || voiceSession.threadId === threadId;
    if (!voiceThreadMatches) {
      return null;
    }

    return {
      type: 'VoiceSession',
      title: 'Voix',
      description: "Contrôlez l'écoute et consultez les transcriptions en temps réel.",
      startLabel: 'Démarrer',
      stopLabel: 'Arrêter',
      showTranscripts: true,
      ...(widgets?.voiceSessionWidget ?? {}),
    };
  }, [threadId, widgets?.voiceSession, widgets?.voiceSessionWidget]);

  const inlineOutboundCallWidget = useMemo<OutboundCallWidget | null>(() => {
    const outboundCall = widgets?.outboundCall;
    if (!outboundCall || outboundCall.enabled === false) {
      return null;
    }

    // Only show when there's an active call
    if (!outboundCall.isActive && outboundCall.status === 'idle') {
      return null;
    }

    return {
      type: 'OutboundCall',
      title: 'Appel sortant',
      description: "Appel en cours. Les transcriptions apparaissent ci-dessous.",
      hangupLabel: 'Raccrocher',
      showTranscripts: true,
      showAudioPlayer: false, // Audio player is rendered separately
      ...(widgets?.outboundCallWidget ?? {}),
    };
  }, [widgets?.outboundCall, widgets?.outboundCallWidget]);

  return {
    inlineVoiceWidget,
    inlineOutboundCallWidget,
  };
}
