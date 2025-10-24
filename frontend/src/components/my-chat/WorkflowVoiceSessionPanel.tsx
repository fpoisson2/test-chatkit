import { useCallback, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import type { UseWorkflowVoiceAgentResult } from "../../voice/useWorkflowVoiceAgent";

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

type MicrophonePermissionState = "unknown" | "granted" | "denied";

type WorkflowVoiceSessionPanelProps = {
  voiceAgent: UseWorkflowVoiceAgentResult;
};

export const WorkflowVoiceSessionPanel = ({ voiceAgent }: WorkflowVoiceSessionPanelProps) => {
  const { t } = useI18n();
  const {
    sessionInfo,
    status,
    isListening,
    transcripts,
    finalTranscripts,
    errors,
    webrtcError,
    activate: _activate,
    deactivate,
    start,
    stop,
    clearErrors,
    submitTranscripts,
    isSubmitting,
    submissionError,
  } = voiceAgent;

  const [microPermission, setMicroPermission] = useState<MicrophonePermissionState>("unknown");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isRequestingMic, setIsRequestingMic] = useState(false);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "connecting":
        return t("voice.workflow.status.connecting");
      case "connected":
        return t("voice.workflow.status.connected");
      case "error":
        return t("voice.workflow.status.error");
      default:
        return t("voice.workflow.status.idle");
    }
  }, [status, t]);

  const microphoneLabel = useMemo(() => {
    switch (microPermission) {
      case "granted":
        return t("voice.workflow.microphone.granted");
      case "denied":
        return t("voice.workflow.microphone.denied");
      default:
        return t("voice.workflow.microphone.pending");
    }
  }, [microPermission, t]);

  const listeningLabel = useMemo(() => {
    if (status !== "connected") {
      return null;
    }
    return isListening
      ? t("voice.workflow.status.listening")
      : t("voice.workflow.status.paused");
  }, [isListening, status, t]);

  const submissionMessage = useMemo(() => {
    if (!submissionError) {
      return null;
    }
    switch (submissionError) {
      case "auth_required":
        return t("voice.workflow.errors.authRequired");
      case "no_session":
        return t("voice.workflow.errors.noSession");
      case "no_transcripts":
        return t("voice.workflow.errors.noTranscripts");
      case "unexpected":
        return t("voice.workflow.errors.submitUnknown");
      default:
        return submissionError;
    }
  }, [submissionError, t]);

  const handleStart = useCallback(async () => {
    setLocalError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setLocalError(t("voice.workflow.errors.unsupported"));
      return;
    }

    setIsRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicroPermission("granted");
      await start();
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError")
      ) {
        setMicroPermission("denied");
        setLocalError(t("voice.workflow.errors.microphoneDenied"));
        return;
      }
      const message = error instanceof Error ? error.message : null;
      setLocalError(message || t("voice.workflow.errors.submitUnknown"));
    } finally {
      setIsRequestingMic(false);
    }
  }, [start, t]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleClearErrors = useCallback(() => {
    clearErrors();
    setLocalError(null);
  }, [clearErrors]);

  if (!sessionInfo) {
    return null;
  }

  const stepLabel = sessionInfo.stepTitle || sessionInfo.stepSlug;
  const hasActiveConnection = status === "connected";
  const canStart = !hasActiveConnection && status !== "connecting";
  const canStop = status === "connecting" || hasActiveConnection;
  const canSubmit = finalTranscripts.length > 0 && !isSubmitting;

  return (
    <section className="voice-chat voice-chat--workflow" aria-live="polite">
      <header className="voice-chat__header">
        <div>
          <h2>{t("voice.workflow.panel.title")}</h2>
          <p className="voice-chat__subtitle">
            {t("voice.workflow.panel.subtitle", { step: stepLabel })}
          </p>
          <p className="voice-chat__subtitle">
            {t("voice.workflow.panel.sessionInfo", {
              model: sessionInfo.model || t("voice.workflow.panel.modelUnknown"),
              voice: sessionInfo.voice || t("voice.workflow.panel.voiceUnknown"),
            })}
          </p>
        </div>
        <div className="voice-chat__actions">
          <button
            className="button"
            type="button"
            disabled={!canStart || isRequestingMic}
            onClick={() => {
              void handleStart();
            }}
          >
            {isRequestingMic
              ? t("voice.workflow.actions.startRequesting")
              : t("voice.workflow.actions.start")}
          </button>
          <button
            className="button button--ghost"
            type="button"
            disabled={!canStop}
            onClick={handleStop}
          >
            {t("voice.workflow.actions.stop")}
          </button>
          <button
            className="button button--ghost"
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              void submitTranscripts();
            }}
          >
            {isSubmitting
              ? t("voice.workflow.actions.submitting")
              : t("voice.workflow.actions.submit")}
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={deactivate}
          >
            {t("voice.workflow.actions.dismiss")}
          </button>
        </div>
      </header>

      <div className="voice-chat__status">
        <span className={`voice-chat__badge voice-chat__badge--${status}`}>{statusLabel}</span>
        <span className="voice-chat__badge voice-chat__badge--secondary">{microphoneLabel}</span>
        {listeningLabel && (
          <span className={`voice-chat__badge voice-chat__badge--${isListening ? "success" : "secondary"}`}>
            {listeningLabel}
          </span>
        )}
      </div>

      {(localError || webrtcError || submissionMessage) && (
        <div className="alert alert--danger" role="status">
          {submissionMessage || localError || webrtcError}
        </div>
      )}

      {isSubmitting && (
        <div className="alert alert--info" role="status">
          {t("voice.workflow.submission.inProgress")}
        </div>
      )}

      {errors.length > 0 && (
        <aside className="voice-chat__errors">
          <div className="voice-chat__errors-header">
            <h3>{t("voice.workflow.errors.title")}</h3>
            <button className="button button--ghost" type="button" onClick={handleClearErrors}>
              {t("voice.workflow.actions.clearErrors")}
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
        <h3>{t("voice.workflow.transcripts.title")}</h3>
        {transcripts.length === 0 ? (
          <p className="voice-chat__empty">{t("voice.workflow.transcripts.empty")}</p>
        ) : (
          <ul className="voice-chat__list">
            {transcripts.map((entry) => (
              <li key={entry.id} className={`voice-chat__item voice-chat__item--${entry.role}`}>
                <div className="voice-chat__item-meta">
                  <span className="voice-chat__role">
                    {entry.role === "assistant"
                      ? t("voice.workflow.transcripts.assistant")
                      : t("voice.workflow.transcripts.user")}
                  </span>
                  <span className="voice-chat__timestamp">{formatTimestamp(entry.timestamp)}</span>
                  <span className={`voice-chat__status voice-chat__status--${entry.status}`}>
                    {entry.status === "completed"
                      ? t("voice.workflow.transcripts.status.completed")
                      : entry.status === "in_progress"
                      ? t("voice.workflow.transcripts.status.inProgress")
                      : t("voice.workflow.transcripts.status.incomplete")}
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

export default WorkflowVoiceSessionPanel;
