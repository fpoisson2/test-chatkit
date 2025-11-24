import React, { useMemo } from 'react';
import type { VoiceSessionInfoWidget } from '../types';
import { useVoiceSessionContext } from '../../contexts/VoiceSessionContext';

interface VoiceSessionInfoComponentProps {
  widget: VoiceSessionInfoWidget;
}

/**
 * Widget pour contrôler une session vocale active
 */
export function VoiceSessionInfoComponent({ widget }: VoiceSessionInfoComponentProps): JSX.Element {
  const { stepTitle } = widget;
  const voiceContext = useVoiceSessionContext();

  const statusLabel = useMemo(() => {
    if (!voiceContext) return 'En attente...';

    switch (voiceContext.status) {
      case 'connecting':
        return 'Connexion en cours...';
      case 'connected':
        return voiceContext.isListening ? 'En écoute' : 'Connecté';
      case 'error':
        return 'Erreur de connexion';
      default:
        return 'En attente...';
    }
  }, [voiceContext]);

  const isActive = voiceContext?.status === 'connected';
  const canStop = voiceContext && (voiceContext.status === 'connected' || voiceContext.status === 'connecting');

  return (
    <div className={`voice-session-info ${isActive ? 'voice-session-info--active' : ''}`}>
      <div className="voice-session-info__header">
        <span className="voice-session-info__icon" aria-hidden="true">
          🎤
        </span>
        <span className="voice-session-info__title">
          {stepTitle || 'Session vocale'}
        </span>
      </div>

      <div className="voice-session-info__status-container">
        <div className="voice-session-info__status-row">
          <span
            className={`voice-session-info__status-indicator ${
              isActive && voiceContext?.isListening
                ? 'voice-session-info__status-indicator--listening'
                : isActive
                  ? 'voice-session-info__status-indicator--connected'
                  : ''
            }`}
            aria-label={statusLabel}
          />
          <span className="voice-session-info__status-text">{statusLabel}</span>
        </div>
      </div>

      {canStop && (
        <div className="voice-session-info__controls">
          <button
            type="button"
            className="voice-session-info__button voice-session-info__button--stop"
            onClick={voiceContext.stopVoiceSession}
            aria-label="Arrêter la session vocale"
          >
            <span className="voice-session-info__button-icon">⏹</span>
            Arrêter
          </button>
        </div>
      )}

      {!voiceContext && (
        <div className="voice-session-info__message">
          La session vocale démarrera automatiquement lors de l'activation.
        </div>
      )}
    </div>
  );
}
