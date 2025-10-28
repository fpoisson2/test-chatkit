import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth";
import type { SessionCreatedEvent } from "../voice/useRealtimeSession";
import { useRealtimeSession } from "../voice/useRealtimeSession";
import { useAudioResampler } from "../voice/resampler";

export type VoiceSessionStatus = "idle" | "connecting" | "connected" | "error";

export type TranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
};

type UseWorkflowVoiceSessionParams = {
  threadId: string | null;
  onError?: (message: string) => void;
  onTranscriptsUpdated?: () => void;
};

const SAMPLE_RATE = 24_000;

const extractTranscriptsFromHistory = (history: unknown[]): TranscriptEntry[] => {
  const result: TranscriptEntry[] = [];
  const byId = new Map<string, TranscriptEntry>();
  const order: string[] = [];

  for (const item of history) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const typed = item as { type?: unknown; role?: unknown };
    if (typed.type !== "message") {
      continue;
    }
    const role = typed.role === "assistant" ? "assistant" : typed.role === "user" ? "user" : null;
    if (!role) {
      continue;
    }

    const statusRaw = typeof (typed as { status?: unknown }).status === "string"
      ? ((typed as { status: string }).status || "").trim()
      : "";
    if (statusRaw && statusRaw !== "completed" && statusRaw !== "in_progress") {
      continue;
    }

    const contents = Array.isArray((typed as { content?: unknown[] }).content)
      ? ((typed as { content: unknown[] }).content ?? [])
      : [];

    const textParts: string[] = [];
    for (const contentItem of contents) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const entry = contentItem as { type?: unknown; text?: unknown; transcript?: unknown };
      if (
        (entry.type === "input_text" || entry.type === "output_text" || entry.type === "text") &&
        typeof entry.text === "string" &&
        entry.text.trim()
      ) {
        textParts.push(entry.text.trim());
      } else if (
        (entry.type === "input_audio" || entry.type === "output_audio" || entry.type === "audio") &&
        typeof entry.transcript === "string" &&
        entry.transcript.trim()
      ) {
        textParts.push(entry.transcript.trim());
      }
    }

    if (!textParts.length) {
      continue;
    }

    const identifier =
      typeof (typed as { item_id?: unknown }).item_id === "string" &&
      (typed as { item_id: string }).item_id.trim()
        ? (typed as { item_id: string }).item_id.trim()
        : `${role}-${order.length}`;

    const entry: TranscriptEntry = {
      id: identifier,
      role,
      text: textParts.join("\n"),
    };
    if (statusRaw) {
      entry.status = statusRaw;
    }

    byId.set(identifier, entry);
    if (!order.includes(identifier)) {
      order.push(identifier);
    }
  }

  for (const identifier of order) {
    const entry = byId.get(identifier);
    if (entry) {
      result.push(entry);
    }
  }

  return result;
};

export const useWorkflowVoiceSession = ({
  threadId,
  onError,
  onTranscriptsUpdated,
}: UseWorkflowVoiceSessionParams) => {
  const { token } = useAuth();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const currentSessionRef = useRef<string | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const processedSessionsRef = useRef<Set<string>>(new Set());
  const resampler = useAudioResampler(SAMPLE_RATE);

  const cleanupCapture = useCallback(() => {
    const processor = processorRef.current;
    processorRef.current = null;
    if (processor) {
      try {
        processor.disconnect();
      } catch {
        /* noop */
      }
      processor.onaudioprocess = null;
    }

    const inputContext = inputContextRef.current;
    inputContextRef.current = null;
    if (inputContext) {
      try {
        inputContext.close().catch(() => undefined);
      } catch {
        /* noop */
      }
    }

    const stream = microphoneStreamRef.current;
    microphoneStreamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* noop */
        }
      });
    }
    resampler.reset();
  }, [resampler]);

  const {
    connect: connectRealtime,
    disconnect: disconnectRealtime,
    sendAudioChunk,
    finalizeSession,
    interruptSession,
  } = useRealtimeSession({
    onConnectionChange: (value) => {
      if (value === "disconnected") {
        setStatus("idle");
        setIsListening(false);
        cleanupCapture();
        currentSessionRef.current = null;
      }
    },
    onTransportError: (error) => {
      onError?.("Erreur de connexion au gateway voix");
      if (import.meta.env.DEV) {
        console.error("[Voice] transport error", error);
      }
      setStatus("error");
    },
    onSessionCreated: (event: SessionCreatedEvent) => {
      const threadMatches =
        threadId == null || event.threadId == null || event.threadId === threadId;
      if (!threadMatches) {
        return;
      }
      if (processedSessionsRef.current.has(event.sessionId)) {
        return;
      }
      processedSessionsRef.current.add(event.sessionId);
      void (async () => {
        try {
          setStatus("connecting");
          await startCapture(event.sessionId);
          setStatus("connected");
          setIsListening(true);
        } catch (error) {
          setStatus("error");
          processedSessionsRef.current.delete(event.sessionId);
          if (error instanceof Error) {
            onError?.(error.message);
          } else {
            onError?.("Impossible de démarrer la session vocale");
          }
        }
      })();
    },
    onHistoryUpdated: (sessionId, history) => {
      if (currentSessionRef.current !== sessionId) {
        return;
      }
      const nextTranscripts = extractTranscriptsFromHistory(history);
      setTranscripts(nextTranscripts);
      onTranscriptsUpdated?.();
    },
    onAgentStart: (sessionId) => {
      if (currentSessionRef.current === sessionId) {
        setIsListening(true);
      }
    },
    onAgentEnd: (sessionId) => {
      if (currentSessionRef.current === sessionId) {
        setIsListening(false);
      }
    },
    onSessionFinalized: (event) => {
      if (currentSessionRef.current !== event.sessionId) {
        return;
      }
      cleanupCapture();
      currentSessionRef.current = null;
      setStatus("idle");
      setIsListening(false);
      if (Array.isArray(event.transcripts) && event.transcripts.length > 0) {
        const mapped = extractTranscriptsFromHistory(event.transcripts as unknown[]);
        setTranscripts(mapped);
        onTranscriptsUpdated?.();
      }
    },
    onSessionError: (sessionId, message) => {
      if (currentSessionRef.current !== sessionId) {
        return;
      }
      setStatus("error");
      if (message) {
        onError?.(message);
      }
    },
  });

  const startCapture = useCallback(
    async (sessionId: string) => {
      if (!threadId) {
        throw new Error("Thread manquant pour la session vocale");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("API microphone non disponible");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;

      const context = new AudioContext();
      inputContextRef.current = context;
      resampler.setSampleRate(context.sampleRate);

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const chunk = resampler.process(input);
        if (chunk.length > 0) {
          sendAudioChunk(sessionId, chunk);
        }
      };

      source.connect(processor);
      processor.connect(context.destination);
      currentSessionRef.current = sessionId;
    },
    [resampler, sendAudioChunk, threadId],
  );

  const stopVoiceSession = useCallback(async () => {
    const sessionId = currentSessionRef.current;
    if (!sessionId) {
      return;
    }

    const tail = resampler.flush();
    if (tail.length > 0) {
      sendAudioChunk(sessionId, tail, { commit: true });
    } else {
      sendAudioChunk(sessionId, new Int16Array(), { commit: true });
    }

    if (threadId) {
      finalizeSession(sessionId, threadId);
    } else {
      finalizeSession(sessionId);
    }

    cleanupCapture();
    setIsListening(false);
    setStatus("idle");
    currentSessionRef.current = null;
  }, [cleanupCapture, finalizeSession, resampler, sendAudioChunk, threadId]);

  useEffect(() => {
    if (!token) {
      disconnectRealtime();
      cleanupCapture();
      setStatus("idle");
      setIsListening(false);
      currentSessionRef.current = null;
      processedSessionsRef.current.clear();
      return;
    }

    let cancelled = false;
    connectRealtime({ token })
      .catch((error) => {
        if (!cancelled) {
          setStatus("error");
          if (error instanceof Error) {
            onError?.(error.message);
          } else {
            onError?.("Connexion au service vocal impossible");
          }
        }
      });

    return () => {
      cancelled = true;
      disconnectRealtime();
      cleanupCapture();
    };
  }, [cleanupCapture, connectRealtime, disconnectRealtime, onError, token]);

  useEffect(() => () => {
    cleanupCapture();
    disconnectRealtime();
  }, [cleanupCapture, disconnectRealtime]);

  return {
    stopVoiceSession,
    status,
    isListening,
    transcripts,
    interruptSession,
  };
};

export type { UseWorkflowVoiceSessionParams };
