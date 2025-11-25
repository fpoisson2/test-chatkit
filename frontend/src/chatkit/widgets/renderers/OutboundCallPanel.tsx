import React, { useCallback, useMemo, useState } from 'react';
import type { OutboundCallWidget } from '../../types';
import type { WidgetContext } from './types';

const formatCallTimestamp = (timestamp?: number) => {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const getStatusLabel = (status: string | undefined): string => {
  switch (status) {
    case 'queued':
      return 'En file d\'attente';
    case 'initiating':
      return 'Initialisation';
    case 'ringing':
      return 'Sonnerie...';
    case 'answered':
      return 'En cours';
    case 'completed':
      return 'Terminé';
    case 'failed':
      return 'Échec';
    case 'busy':
      return 'Occupé';
    case 'no_answer':
      return 'Pas de réponse';
    default:
      return 'En attente';
  }
};

const getStatusBadgeClass = (status: string | undefined): string => {
  switch (status) {
    case 'answered':
      return 'badge-soft-success';
    case 'ringing':
    case 'initiating':
    case 'queued':
      return 'badge-soft-info';
    case 'completed':
      return 'badge-soft-secondary';
    case 'failed':
    case 'busy':
    case 'no_answer':
      return 'badge-soft-danger';
    default:
      return 'badge-soft-secondary';
  }
};

export const OutboundCallPanel = ({ widget, context }: { widget: OutboundCallWidget; context: WidgetContext }): JSX.Element => {
  const outboundCall = context.outboundCall;
  const [isHangingUp, setIsHangingUp] = useState(false);

  const handleHangup = useCallback(async () => {
    if (!outboundCall?.hangupCall) {
      return;
    }
    setIsHangingUp(true);
    try {
      outboundCall.hangupCall();
    } catch (error) {
      console.error('[OutboundCallPanel] Error hanging up call', error);
    } finally {
      setIsHangingUp(false);
    }
  }, [outboundCall]);

  if (!outboundCall) {
    return (
      <div className="alert alert-warning text-sm">
        Le contexte d'appel sortant n'est pas disponible pour ce widget.
      </div>
    );
  }

  const isCallActive = outboundCall.isActive ||
    ['queued', 'initiating', 'ringing', 'answered'].includes(outboundCall.status);
  const hangupDisabled = isHangingUp || !isCallActive || !outboundCall.hangupCall;

  const transcriptContent = (() => {
    if (!(widget.showTranscripts ?? true)) {
      return null;
    }

    if (!outboundCall.transcripts || outboundCall.transcripts.length === 0) {
      if (isCallActive) {
        return <p className="text-sm text-secondary">En attente de la conversation...</p>;
      }
      return <p className="text-sm text-secondary">Aucune transcription disponible.</p>;
    }

    return (
      <ul className="space-y-2">
        {outboundCall.transcripts.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
              <span className="font-semibold">
                {entry.role === 'assistant' ? 'Agent' : 'Interlocuteur'}
              </span>
              <span>{formatCallTimestamp(entry.timestamp)}</span>
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
          <h3 className="text-lg font-semibold">{widget.title ?? 'Appel sortant'}</h3>
          <p className="text-sm text-secondary">
            {widget.description ?? (
              isCallActive
                ? "Appel en cours. Les transcriptions apparaîtront ci-dessous."
                : "L'appel sera initié automatiquement."
            )}
          </p>
          {outboundCall.toNumber && (
            <p className="text-sm font-medium">
              Numéro : {outboundCall.toNumber}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isCallActive && (
            <button
              className="btn btn-danger btn-sm"
              type="button"
              disabled={hangupDisabled}
              onClick={handleHangup}
            >
              {isHangingUp ? 'Raccrochage...' : widget.hangupLabel ?? 'Raccrocher'}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`badge ${getStatusBadgeClass(outboundCall.status)}`}>
          {getStatusLabel(outboundCall.status)}
        </span>
        {outboundCall.callId && (
          <span className="text-xs text-secondary">
            ID: {outboundCall.callId.slice(0, 8)}...
          </span>
        )}
      </div>

      {outboundCall.error ? (
        <div className="alert alert-danger text-sm" role="status">
          {outboundCall.error}
        </div>
      ) : null}

      {transcriptContent}
    </section>
  );
};
