import React, { useCallback, useMemo, useState } from 'react';
import type { VoiceSessionWidget } from '../../types';
import type { WidgetContext } from './types';

const formatVoiceTimestamp = (timestamp?: number) => {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const VoiceSessionPanel = ({ widget, context }: { widget: VoiceSessionWidget; context: WidgetContext }): JSX.Element => {
  const voice = context.voiceSession;
  const [isStarting, setIsStarting] = useState(false);

  const statusLabel = useMemo(() => {
    if (!voice) {
      return 'Indisponible';
    }
    switch (voice.status) {
      case 'connecting':
        return 'Connexion en cours';
      case 'connected':
        return voice.isListening ? 'En écoute' : 'Connecté';
      case 'error':
        return 'Erreur';
      default:
        return 'En veille';
    }
  }, [voice]);

  const handleStart = useCallback(async () => {
    if (!voice?.startVoiceSession) {
      return;
    }
    setIsStarting(true);
    try {
      await voice.startVoiceSession();
    } catch (error) {
      console.error('[VoiceSessionWidget] Error starting voice session', error);
    } finally {
      setIsStarting(false);
    }
  }, [voice]);

  const handleStop = useCallback(() => {
    voice?.interruptSession?.();
    voice?.stopVoiceSession?.();
  }, [voice]);

  if (!voice) {
    return (
      <div className="alert alert-warning text-sm">
        Le contexte vocal n'est pas disponible pour ce widget.
      </div>
    );
  }

  const startDisabled =
    isStarting || voice.status === 'connecting' || voice.status === 'connected' || !voice.startVoiceSession || !voice.threadId;
  const stopDisabled = (voice.status === 'idle' && !voice.isListening) || voice.status === 'error';

  const transcriptContent = (() => {
    if (!(widget.showTranscripts ?? true)) {
      return null;
    }

    if (voice.transcripts.length === 0) {
      return <p className="text-sm text-secondary">Aucune transcription disponible pour le moment.</p>;
    }

    return (
      <ul className="space-y-2">
        {voice.transcripts.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
              <span className="font-semibold">
                {entry.role === 'assistant' ? 'Assistant' : 'Utilisateur'}
              </span>
              <span>{formatVoiceTimestamp(entry.timestamp)}</span>
              {entry.status ? (
                <span className="badge badge-soft-secondary capitalize">{entry.status.replace('_', ' ')}</span>
              ) : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{entry.text}</p>
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{widget.title ?? 'Session vocale'}</h3>
          <p className="text-sm text-secondary">
            {!voice.threadId
              ? "Envoyez un premier message pour démarrer une session vocale."
              : (widget.description ?? "Contrôlez l'écoute et consultez les transcriptions en temps réel.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={startDisabled}
            onClick={handleStart}
          >
            {isStarting ? 'Connexion…' : widget.startLabel ?? 'Démarrer'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={stopDisabled}
            onClick={handleStop}
          >
            {widget.stopLabel ?? 'Arrêter'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="badge badge-soft-info">{statusLabel}</span>
        {voice.status === 'connected' ? (
          <span className="badge badge-soft-success">{voice.isListening ? 'En écoute' : 'Pause'}</span>
        ) : null}
      </div>

      {voice.transportError ? (
        <div className="alert alert-danger text-sm" role="status">
          {voice.transportError}
        </div>
      ) : null}

      {transcriptContent}
    </section>
  );
};
