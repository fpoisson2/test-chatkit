import { useMemo } from "react";

import { useI18n } from "../../i18n";
import type { VoiceSessionStatus, VoiceTranscript } from "../../voice/useVoiceSession";
import type { MicrophonePermissionState } from "../../voice/microphone";

const MAX_VISIBLE_TRANSCRIPTS = 3;

type VoiceOverlayProps = {
  visible: boolean;
  status: VoiceSessionStatus;
  isListening: boolean;
  microPermission: MicrophonePermissionState;
  isRequestingMic: boolean;
  workflowTitle: string | null;
  onStart: () => void;
  onStop: () => void;
  errorMessage: string | null;
  webrtcError: string | null;
  transcripts: VoiceTranscript[];
};

const buildStatusLabel = (
  status: VoiceSessionStatus,
  t: ReturnType<typeof useI18n>["t"],
): string => {
  switch (status) {
    case "connecting":
      return t("voiceOverlay.status.connecting");
    case "connected":
      return t("voiceOverlay.status.connected");
    case "error":
      return t("voiceOverlay.status.error");
    default:
      return t("voiceOverlay.status.idle");
  }
};

const buildMicrophoneLabel = (
  state: MicrophonePermissionState,
  t: ReturnType<typeof useI18n>["t"],
): string => {
  switch (state) {
    case "granted":
      return t("voiceOverlay.microphone.granted");
    case "denied":
      return t("voiceOverlay.microphone.denied");
    default:
      return t("voiceOverlay.microphone.pending");
  }
};

export const VoiceOverlay = ({
  visible,
  status,
  isListening,
  microPermission,
  isRequestingMic,
  workflowTitle,
  onStart,
  onStop,
  errorMessage,
  webrtcError,
  transcripts,
}: VoiceOverlayProps) => {
  const { t } = useI18n();

  const combinedError = errorMessage ?? webrtcError ?? null;

  const statusLabel = useMemo(() => buildStatusLabel(status, t), [status, t]);
  const microphoneLabel = useMemo(
    () => buildMicrophoneLabel(microPermission, t),
    [microPermission, t],
  );
  const listeningLabel = isListening
    ? t("voiceOverlay.listenIndicator.active")
    : t("voiceOverlay.listenIndicator.inactive");

  const recentTranscripts = useMemo(
    () => transcripts.slice(-MAX_VISIBLE_TRANSCRIPTS),
    [transcripts],
  );

  if (!visible) {
    return null;
  }

  const canStart = status !== "connecting" && status !== "connected" && !isRequestingMic;
  const canStop = status === "connected" || status === "connecting";

  return (
    <aside className="voice-overlay" role="status" aria-live="polite">
      <header className="voice-overlay__header">
        <div className="voice-overlay__titles">
          <p className="voice-overlay__title">{t("voiceOverlay.title")}</p>
          <p className="voice-overlay__subtitle">
            {workflowTitle ? t("voiceOverlay.subtitle", { title: workflowTitle }) : t("voiceOverlay.subtitleUnknown")}
          </p>
        </div>
        <div className="voice-overlay__actions">
          <button
            type="button"
            className="voice-overlay__button"
            disabled={!canStart}
            onClick={onStart}
          >
            {isRequestingMic ? t("voiceOverlay.actions.requesting") : t("voiceOverlay.actions.start")}
          </button>
          <button
            type="button"
            className="voice-overlay__button voice-overlay__button--ghost"
            disabled={!canStop}
            onClick={onStop}
          >
            {t("voiceOverlay.actions.stop")}
          </button>
        </div>
      </header>

      <div className="voice-overlay__badges">
        <span className={`voice-overlay__badge voice-overlay__badge--${status}`}>{statusLabel}</span>
        <span className="voice-overlay__badge voice-overlay__badge--secondary">{microphoneLabel}</span>
        {status === "connected" && (
          <span className="voice-overlay__badge voice-overlay__badge--success">{listeningLabel}</span>
        )}
      </div>

      {combinedError && <div className="voice-overlay__error">{combinedError}</div>}

      <section className="voice-overlay__transcripts">
        <h3 className="voice-overlay__section-title">{t("voiceOverlay.transcripts.title")}</h3>
        {recentTranscripts.length === 0 ? (
          <p className="voice-overlay__empty">{t("voiceOverlay.transcripts.empty")}</p>
        ) : (
          <ul className="voice-overlay__list">
            {recentTranscripts.map((entry) => (
              <li key={entry.id} className={`voice-overlay__item voice-overlay__item--${entry.role}`}>
                <div className="voice-overlay__item-meta">
                  <span className="voice-overlay__item-role">
                    {entry.role === "assistant"
                      ? t("voiceOverlay.transcripts.assistant")
                      : t("voiceOverlay.transcripts.user")}
                  </span>
                  <span className={`voice-overlay__item-status voice-overlay__item-status--${entry.status}`}>
                    {entry.status === "completed"
                      ? t("voiceOverlay.transcripts.status.completed")
                      : entry.status === "in_progress"
                      ? t("voiceOverlay.transcripts.status.inProgress")
                      : t("voiceOverlay.transcripts.status.incomplete")}
                  </span>
                </div>
                <p className="voice-overlay__item-text">{entry.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
};
