import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { OutboundCallWidget } from '../../types';
import type { WidgetContext } from './types';

type AudioChannel = 'inbound' | 'outbound' | 'mixed';

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

// Audio Player Hook
const useAudioPlayer = (callId: string | null, enabled: boolean) => {
  const [isAudioConnected, setIsAudioConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [channelFilter, setChannelFilter] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [audioError, setAudioError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRefs = useRef<Record<string, number>>({
    default: 0,
    inbound: 0,
    outbound: 0,
    mixed: 0,
  });
  const isMutedRef = useRef(isMuted);
  const channelFilterRef = useRef(channelFilter);

  // Keep refs in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    channelFilterRef.current = channelFilter;
  }, [channelFilter]);

  // Initialize Audio Context
  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
        sampleRate: 24000,
      });
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // Play audio chunk
  const playAudioChunk = useCallback(
    (pcmData: Int16Array, channel: AudioChannel | undefined) => {
      if (!audioContextRef.current || !gainNodeRef.current) {
        initializeAudioContext();
        if (!audioContextRef.current || !gainNodeRef.current) return;
      }

      const audioContext = audioContextRef.current;
      const gainNode = gainNodeRef.current;

      const channelKey = channel ?? 'default';
      if (!(channelKey in nextPlayTimeRefs.current)) {
        nextPlayTimeRefs.current[channelKey] = 0;
      }

      // Convert PCM16 to Float32
      const float32Array = new Float32Array(pcmData.length);
      for (let i = 0; i < float32Array.length; i++) {
        float32Array[i] = Math.max(-1, Math.min(1, pcmData[i] / 0x8000));
      }

      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      // Create source node
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);

      // Schedule playback
      const now = audioContext.currentTime;
      const startTime = Math.max(now, nextPlayTimeRefs.current[channelKey]);
      source.start(startTime);

      // Update next play time
      nextPlayTimeRefs.current[channelKey] = startTime + audioBuffer.duration;

      // Clean up after playback
      source.onended = () => {
        const index = audioQueueRef.current.indexOf(source);
        if (index > -1) {
          audioQueueRef.current.splice(index, 1);
        }
      };

      audioQueueRef.current.push(source);
    },
    [initializeAudioContext]
  );

  // Connect to WebSocket for audio streaming
  useEffect(() => {
    if (!callId || !enabled) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/call/${callId}/audio/stream`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    const decodeChannel = (code: number): AudioChannel | undefined => {
      switch (code) {
        case 1:
          return 'inbound';
        case 2:
          return 'outbound';
        case 3:
          return 'mixed';
        default:
          return undefined;
      }
    };

    const handleAudioFrame = (buffer: ArrayBuffer) => {
      if (buffer.byteLength <= 2) {
        return;
      }

      const view = new DataView(buffer);
      const channel = decodeChannel(view.getUint8(0));

      if (isMutedRef.current) {
        return;
      }

      if (channelFilterRef.current !== 'all' && channel !== channelFilterRef.current) {
        return;
      }

      const audioSlice = buffer.slice(2);
      if (audioSlice.byteLength === 0) {
        return;
      }

      const pcm16 = new Int16Array(audioSlice);
      playAudioChunk(pcm16, channel);
    };

    ws.onopen = () => {
      setIsAudioConnected(true);
      setAudioError(null);
      initializeAudioContext();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const packet = JSON.parse(event.data);
          if (packet.type === 'error') {
            setAudioError(packet.message || 'Erreur audio');
          }
        } catch {
          // Ignore parse errors
        }
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        handleAudioFrame(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        event.data
          .arrayBuffer()
          .then(handleAudioFrame)
          .catch(() => {
            // Ignore blob read errors
          });
      }
    };

    ws.onerror = () => {
      setAudioError('Erreur de connexion audio');
      setIsAudioConnected(false);
    };

    ws.onclose = () => {
      setIsAudioConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;

      // Stop all playing audio
      audioQueueRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Ignore if already stopped
        }
      });
      audioQueueRef.current = [];
      nextPlayTimeRefs.current = { default: 0, inbound: 0, outbound: 0, mixed: 0 };

      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        gainNodeRef.current = null;
      }
    };
  }, [callId, enabled, initializeAudioContext, playAudioChunk]);

  // Update volume
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  return {
    isAudioConnected,
    isMuted,
    setIsMuted,
    volume,
    setVolume,
    channelFilter,
    setChannelFilter,
    audioError,
  };
};

export const OutboundCallPanel = ({ widget, context }: { widget: OutboundCallWidget; context: WidgetContext }): JSX.Element => {
  const outboundCall = context.outboundCall;
  const [isHangingUp, setIsHangingUp] = useState(false);

  const showAudioPlayer = widget.showAudioPlayer ?? true;
  const isCallActive = outboundCall?.isActive ||
    (outboundCall && ['queued', 'initiating', 'ringing', 'answered'].includes(outboundCall.status));

  const {
    isAudioConnected,
    isMuted,
    setIsMuted,
    volume,
    setVolume,
    channelFilter,
    setChannelFilter,
    audioError,
  } = useAudioPlayer(outboundCall?.callId ?? null, showAudioPlayer && !!isCallActive);

  const handleHangup = useCallback(async () => {
    if (!outboundCall?.hangupCall) {
      return;
    }
    setIsHangingUp(true);
    try {
      outboundCall.hangupCall();
    } catch (error) {
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

  const audioPlayerContent = (() => {
    if (!showAudioPlayer || !isCallActive) {
      return null;
    }

    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${isAudioConnected ? 'bg-green-500' : 'bg-orange-500'}`}
            style={isAudioConnected ? { animation: 'pulse 1.5s infinite' } : undefined}
          />
          <span className="text-sm font-medium">
            {isAudioConnected ? 'Audio connecté' : 'Connexion audio...'}
          </span>
        </div>

        {audioError && (
          <p className="text-xs text-danger mb-2">{audioError}</p>
        )}

        {/* Volume control */}
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            className="btn btn-sm btn-secondary"
            style={{ minWidth: '70px' }}
          >
            {isMuted ? '🔇 Muet' : '🔊 Son'}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            disabled={isMuted}
            className="flex-1"
            style={{ cursor: 'pointer' }}
          />
          <span className="text-xs text-secondary" style={{ minWidth: '35px' }}>
            {Math.round(volume * 100)}%
          </span>
        </div>

        {/* Channel filter */}
        <div className="flex gap-1">
          {(['all', 'inbound', 'outbound'] as const).map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => setChannelFilter(ch)}
              className={`btn btn-xs ${channelFilter === ch ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1 }}
            >
              {ch === 'all' ? '🎧 Tout' : ch === 'inbound' ? '🎤 Entrant' : '🔊 Sortant'}
            </button>
          ))}
        </div>
      </div>
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

      {audioPlayerContent}

      {transcriptContent}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </section>
  );
};
