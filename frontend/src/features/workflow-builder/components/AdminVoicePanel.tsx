/**
 * Floating admin voice panel for the workflow builder.
 * Uses the Realtime API via the gateway WebSocket to provide a voice assistant
 * that can manage workflow steps, check student progress, etc.
 */
import { Mic, MicOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../../../auth";
import { useI18n } from "../../../i18n";
import { workflowsApi } from "../../../utils/backend";
import styles from "./AdminVoicePanel.module.css";

type AdminVoicePanelProps = {
  workflowId: number;
};

type VoiceStatus = "idle" | "connecting" | "connected" | "error";

type Transcript = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export const AdminVoicePanel = ({ workflowId }: AdminVoicePanelProps) => {
  const { t } = useI18n();
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    if (!token || !workflowId) return;

    setStatus("connecting");
    setError(null);
    setTranscripts([]);

    try {
      // 1. Get ephemeral key from backend
      const session = await workflowsApi.createAdminVoiceSession(token, workflowId);

      // 2. Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Set up audio output
      const audio = audioRef.current ?? new Audio();
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      // Add microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Set up data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleRealtimeEvent(msg);
        } catch {
          // ignore parse errors
        }
      };

      // Create offer and connect
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const realtimeUrl = "https://api.openai.com/v1/realtime";
      const model = session.model || "gpt-4o-realtime-preview";

      const sdpResponse = await fetch(`${realtimeUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.client_secret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        throw new Error(`Realtime connection failed: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setStatus("connected");
    } catch (err) {
      cleanup();
      setError(err instanceof Error ? err.message : "Connection failed");
      setStatus("error");
    }
  }, [token, workflowId, cleanup]);

  const handleRealtimeEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string;

    if (type === "response.audio_transcript.done") {
      const text = (event.transcript as string) || "";
      if (text) {
        setTranscripts((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", text },
        ]);
      }
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = (event.transcript as string) || "";
      if (text) {
        setTranscripts((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: "user", text },
        ]);
      }
    }

    if (type === "error") {
      const errData = event.error as Record<string, unknown> | undefined;
      const message = (errData?.message as string) || "Realtime error";
      setError(message);
    }
  }, []);

  const stopSession = useCallback(() => {
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  const togglePanel = useCallback(() => {
    if (isOpen && status === "connected") {
      stopSession();
    }
    setIsOpen((v) => !v);
  }, [isOpen, status, stopSession]);

  // Cleanup on unmount
  useEffect(() => () => cleanup(), [cleanup]);

  return (
    <>
      <button
        type="button"
        className={`${styles.floatingButton} ${status === "connected" ? styles.floatingButtonActive : ""}`}
        onClick={togglePanel}
        title={t("workflowBuilder.adminVoice.title")}
      >
        {status === "connected" ? <MicOff size={20} /> : <Mic size={20} />}
      </button>

      {isOpen ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              {t("workflowBuilder.adminVoice.title")}
            </span>
            <button
              type="button"
              className={styles.closeButton}
              onClick={togglePanel}
            >
              <X size={16} />
            </button>
          </div>

          <div className={styles.panelBody}>
            {transcripts.length > 0 ? (
              <div className={styles.transcripts}>
                {transcripts.map((entry) => (
                  <div
                    key={entry.id}
                    className={`${styles.transcript} ${
                      entry.role === "user" ? styles.transcriptUser : styles.transcriptAssistant
                    }`}
                  >
                    <span className={styles.transcriptRole}>
                      {entry.role === "user"
                        ? t("workflowBuilder.adminVoice.you")
                        : t("workflowBuilder.adminVoice.assistant")}
                    </span>
                    <span className={styles.transcriptText}>{entry.text}</span>
                  </div>
                ))}
                <div ref={transcriptsEndRef} />
              </div>
            ) : (
              <div className={styles.placeholder}>
                {status === "connected"
                  ? t("workflowBuilder.adminVoice.listening")
                  : t("workflowBuilder.adminVoice.description")}
              </div>
            )}

            {error ? (
              <div className={styles.error}>{error}</div>
            ) : null}
          </div>

          <div className={styles.panelFooter}>
            {status === "idle" || status === "error" ? (
              <button
                type="button"
                className={styles.startButton}
                onClick={startSession}
              >
                <Mic size={16} />
                {t("workflowBuilder.adminVoice.start")}
              </button>
            ) : status === "connecting" ? (
              <button type="button" className={styles.startButton} disabled>
                {t("workflowBuilder.adminVoice.connecting")}
              </button>
            ) : (
              <button
                type="button"
                className={styles.stopButton}
                onClick={stopSession}
              >
                <MicOff size={16} />
                {t("workflowBuilder.adminVoice.stop")}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
};
