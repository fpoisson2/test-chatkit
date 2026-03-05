import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

import { useAuth } from "../auth";
import { useWorkflows } from "../hooks/useWorkflows";
import { workflowsApi } from "../utils/backend";
import styles from "./AdminVoicePage.module.css";

type VoiceStatus = "idle" | "connecting" | "connected" | "error";

export default function AdminVoicePage() {
  const { token } = useAuth();
  const { data: workflows } = useWorkflows(token);
  const [workflowId, setWorkflowId] = useState<number | null>(null);
  const [status, setStatus] = useState<VoiceStatus>("idle");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const handleRealtimeEventRef = useRef<(e: Record<string, unknown>) => void>(
    () => {},
  );

  // Auto-select first workflow
  useEffect(() => {
    if (!workflowId && workflows?.length) {
      setWorkflowId(workflows[0].id);
    }
  }, [workflows, workflowId]);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
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
    analyserRef.current = null;
  }, []);

  const startAudioVisualization = useCallback(
    (audioElement: HTMLAudioElement) => {
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(audioElement);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length / 255;

          const scale = 1.0 + avg * 1.5;
          const opacity = 0.3 + avg * 0.7;
          if (orbRef.current) {
            orbRef.current.style.transform = `translate(-50%, -50%) scale(${scale})`;
            orbRef.current.style.opacity = `${opacity}`;
          }

          animFrameRef.current = requestAnimationFrame(tick);
        };
        animFrameRef.current = requestAnimationFrame(tick);
      } catch {
        // AudioContext not supported
      }
    },
    [],
  );

  const sendDataChannelEvent = useCallback(
    (event: Record<string, unknown>) => {
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(JSON.stringify(event));
      }
    },
    [],
  );

  const handleToolCall = useCallback(
    async (callId: string, toolName: string, args: string) => {
      if (!workflowId) return;
      console.log("[AdminVoice] Tool call:", toolName, args);
      let result: string;
      try {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(args || "{}");
        } catch {
          console.warn("[AdminVoice] Malformed tool args, using {}:", args);
          parsed = {};
        }
        const resp = await workflowsApi.executeAdminVoiceTool(
          tokenRef.current,
          workflowId,
          toolName,
          parsed,
        );
        result = resp.result;
        console.log("[AdminVoice] Tool result:", result);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : "Tool execution failed"}`;
        console.error("[AdminVoice] Tool error:", err);
      }

      sendDataChannelEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: result,
        },
      });
      sendDataChannelEvent({ type: "response.create" });

      if (
        toolName === "improve_step_content" ||
        toolName === "publish_step_message"
      ) {
        window.dispatchEvent(
          new CustomEvent("chatkit:live-update", { detail: { workflowId } }),
        );
      }
    },
    [workflowId, sendDataChannelEvent],
  );

  const handleRealtimeEvent = useCallback(
    (event: Record<string, unknown>) => {
      const type = event.type as string;

      if (type && !type.includes("audio_buffer") && !type.includes("audio.delta")) {
        console.log("[AdminVoice] Event:", type);
      }

      if (type === "response.function_call_arguments.done") {
        const callId = (event.call_id as string) || "";
        const toolName = (event.name as string) || "";
        const args = (event.arguments as string) || "{}";
        handleToolCall(callId, toolName, args);
      }

      if (type === "error") {
        const errData = event.error as Record<string, unknown> | undefined;
        console.error("Realtime error:", errData?.message || "Unknown");
      }
    },
    [handleToolCall],
  );
  handleRealtimeEventRef.current = handleRealtimeEvent;

  const startSession = useCallback(async () => {
    if (!token || !workflowId) return;
    setStatus("connecting");

    try {
      const session = await workflowsApi.createAdminVoiceSession(
        token,
        workflowId,
      );

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = audioRef.current ?? new Audio();
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        startAudioVisualization(audio);
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleRealtimeEventRef.current(msg);
        } catch {
          // ignore
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = session.model || "gpt-realtime-1.5";
      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.client_secret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );

      if (!sdpResponse.ok) {
        throw new Error(`Connection failed: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setStatus("connected");
    } catch (err) {
      cleanup();
      console.error("Voice session error:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [token, workflowId, cleanup, startAudioVisualization]);

  const stopSession = useCallback(() => {
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (status === "connected") {
      stopSession();
    } else if (status === "idle" || status === "error") {
      startSession();
    }
  }, [status, startSession, stopSession]);

  useEffect(() => () => cleanup(), [cleanup]);

  const selectedWorkflow = workflows?.find((w) => w.id === workflowId);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Assistant vocal</h1>
        <select
          className={styles.select}
          value={workflowId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setWorkflowId(val ? Number(val) : null);
            if (status === "connected") stopSession();
          }}
        >
          <option value="" disabled>
            Choisir un workflow...
          </option>
          {workflows?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.display_name || w.slug}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.center}>
        <div className={styles.orbContainer}>
          {status === "connected" && (
            <div ref={orbRef} className={styles.orb} />
          )}
          <button
            type="button"
            className={`${styles.micButton} ${
              status === "connected"
                ? styles.micButtonActive
                : status === "connecting"
                  ? styles.micButtonConnecting
                  : status === "error"
                    ? styles.micButtonError
                    : ""
            }`}
            onClick={toggle}
            disabled={status === "connecting" || !workflowId}
          >
            <Mic size={48} />
          </button>
        </div>

        <p className={styles.statusText}>
          {status === "idle" && "Appuie pour parler"}
          {status === "connecting" && "Connexion..."}
          {status === "connected" &&
            `Connect\u00e9 \u2014 ${selectedWorkflow?.display_name ?? ""}`}
          {status === "error" && "Erreur de connexion"}
        </p>
      </div>
    </div>
  );
}
