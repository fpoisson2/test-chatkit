import React from 'react';
import type { VoiceSessionInfoWidget } from '../types';

interface VoiceSessionInfoComponentProps {
  widget: VoiceSessionInfoWidget;
}

/**
 * Widget pour afficher les informations d'une session vocale
 */
export function VoiceSessionInfoComponent({ widget }: VoiceSessionInfoComponentProps): JSX.Element {
  const { sessionId, model, voice, stepTitle, stepSlug } = widget;

  return (
    <div className="voice-session-info">
      <div className="voice-session-info__header">
        <span className="voice-session-info__icon" aria-hidden="true">
          🎤
        </span>
        <span className="voice-session-info__title">
          {stepTitle || 'Session vocale'}
        </span>
      </div>
      <div className="voice-session-info__content">
        {model && (
          <div className="voice-session-info__row">
            <span className="voice-session-info__label">Modèle :</span>
            <span className="voice-session-info__value">{model}</span>
          </div>
        )}
        {voice && (
          <div className="voice-session-info__row">
            <span className="voice-session-info__label">Voix :</span>
            <span className="voice-session-info__value">{voice}</span>
          </div>
        )}
        <div className="voice-session-info__row">
          <span className="voice-session-info__label">ID de session :</span>
          <span className="voice-session-info__value voice-session-info__value--mono">
            {sessionId.slice(0, 8)}...
          </span>
        </div>
        {stepSlug && (
          <div className="voice-session-info__row">
            <span className="voice-session-info__label">Étape :</span>
            <span className="voice-session-info__value voice-session-info__value--mono">
              {stepSlug}
            </span>
          </div>
        )}
      </div>
      <div className="voice-session-info__footer">
        <span className="voice-session-info__status">
          <span className="voice-session-info__status-indicator" aria-label="Actif" />
          Session active
        </span>
      </div>
    </div>
  );
}
