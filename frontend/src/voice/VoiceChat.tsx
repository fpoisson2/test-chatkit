import { useCallback, useMemo, useState } from "react";

import { useVoiceSession } from "./useVoiceSession";

type MicrophonePermissionState = "unknown" | "granted" | "denied";

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export const VoiceChat = () => {
  const { startSession, stopSession, status, isListening, transcripts, errors, transportError, clearErrors } =
    useVoiceSession();
  const [microPermission, setMicroPermission] = useState<MicrophonePermissionState>("unknown");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRequestingMic, setIsRequestingMic] = useState(false);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "connecting":
        return "Connexion en cours";
      case "connected":
        return "Connecté";
      case "error":
        return "Erreur";
      default:
        return "En veille";
    }
  }, [status]);

  const handleStart = useCallback(async () => {
    setLocalError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setLocalError("Accès au microphone non supporté sur ce navigateur.");
      return;
    }

    setIsRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicroPermission("granted");
      await startSession({ preserveHistory: false, stream });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        setMicroPermission("denied");
        setLocalError("Permission microphone refusée.");
        return;
      }
      const message = error instanceof Error ? error.message : "Impossible d'activer le microphone.";
      setLocalError(message);
    } finally {
      setIsRequestingMic(false);
    }
  }, [startSession]);

  const handleStop = useCallback(() => {
    stopSession();
  }, [stopSession]);

  const hasActiveSession = status === "connected";

  return (
    <section className="voice-chat">
      <header className="voice-chat__header">
        <div>
          <h2>Assistant vocal</h2>
          <p className="voice-chat__subtitle">
            Lancez une session Realtime pour discuter à la voix avec votre agent ChatKit.
          </p>
        </div>
        <div className="voice-chat__actions">
          <button
            className="button"
            type="button"
            disabled={status === "connecting" || hasActiveSession || isRequestingMic}
            onClick={() => {
              void handleStart();
            }}
          >
            {isRequestingMic ? "Demande de permission…" : "Démarrer l'écoute"}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={!hasActiveSession && status !== "connecting"}
            onClick={handleStop}
          >
            Arrêter
          </button>
        </div>
      </header>

      <div className="voice-chat__status">
        <span className={`voice-chat__badge voice-chat__badge--${status}`}>{statusLabel}</span>
        <span className="voice-chat__badge voice-chat__badge--secondary">
          Micro {microPermission === "granted" ? "autorisé" : microPermission === "denied" ? "refusé" : "en attente"}
        </span>
        {hasActiveSession && (
          <span className="voice-chat__badge voice-chat__badge--success">
            {isListening ? "En écoute" : "Pause"}
          </span>
        )}
      </div>

      {(transportError || localError) && (
        <div className="alert alert--danger" role="status">
          {localError || transportError}
        </div>
      )}

      {errors.length > 0 && (
        <aside className="voice-chat__errors">
          <div className="voice-chat__errors-header">
            <h3>Journal des erreurs</h3>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                clearErrors();
                setLocalError(null);
              }}
            >
              Effacer
            </button>
          </div>
          <ul>
            {errors.map((entry) => (
              <li key={entry.id}>
                <strong>{formatTimestamp(entry.timestamp)}</strong> — {entry.message}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <section className="voice-chat__transcripts">
        <h3>Transcriptions</h3>
        {transcripts.length === 0 ? (
          <p className="voice-chat__empty">Aucune transcription disponible pour le moment.</p>
        ) : (
          <ul className="voice-chat__list">
            {transcripts.map((entry) => (
              <li key={entry.id} className={`voice-chat__item voice-chat__item--${entry.role}`}>
                <div className="voice-chat__item-meta">
                  <span className="voice-chat__role">{entry.role === "assistant" ? "Assistant" : "Utilisateur"}</span>
                  <span className="voice-chat__timestamp">{formatTimestamp(entry.timestamp)}</span>
                  <span className={`voice-chat__status voice-chat__status--${entry.status}`}>
                    {entry.status === "completed"
                      ? "Finalisé"
                      : entry.status === "in_progress"
                      ? "En cours"
                      : "Incomplet"}
                  </span>
                </div>
                <p className="voice-chat__text">{entry.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};

export default VoiceChat;

