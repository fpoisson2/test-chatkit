import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth";
import { makeApiEndpointCandidates } from "../utils/backend";
import { useRealtimeSession } from "../voice/useRealtimeSession";

type VoiceSessionStatus = "idle" | "connecting" | "connected" | "error";

type VoiceSessionEventPayload =
  | {
      type: "realtime.event";
      step: {
        slug: string;
        title: string;
      };
      event: {
        type: "history";
        session_id?: string;
        client_secret: string | { value: string; expires_at: number };
        session: {
          model: string;
          voice: string;
          instructions: string;
          realtime: {
            start_mode: string;
            stop_mode: string;
            tools: Record<string, boolean>;
          };
          tools?: unknown[];
        };
        tool_permissions: Record<string, boolean>;
      };
    }
  | {
      type: "voice_session.created";
      step: {
        slug: string;
        title: string;
      };
      client_secret: string | { value: string; expires_at: number };
      session: {
        model: string;
        voice: string;
        instructions: string;
        realtime: {
          start_mode: string;
          stop_mode: string;
          tools: Record<string, boolean>;
        };
        tools?: unknown[];
      };
      tool_permissions: Record<string, boolean>;
    };

type UseWorkflowVoiceSessionParams = {
  threadId: string | null;
  onError?: (message: string) => void;
  onTranscriptsUpdated?: () => void;
};

type TranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
};

type TranscriptPayload = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
};

type TranscriptSnapshot = {
  payload: TranscriptPayload[];
};

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

type RealtimeItem = {
  type: string;
  itemId?: string;
  role?: string;
  status?: string;
  content?: { type: string; text?: string; transcript?: string }[];
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
  const processedSessionsRef = useRef<Set<string>>(new Set());
  const currentSessionRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const conversationHistoryRef = useRef<TranscriptEntry[]>([]);
  const submittedTranscriptSignaturesRef = useRef<Map<string, string>>(new Map());
  const hasSubmittedUserRef = useRef(false);
  const queuedSendRef = useRef(false);
  const uploadInFlightRef = useRef(false);

  const createSnapshot = useCallback(
    (entries: TranscriptEntry[]): TranscriptSnapshot | null => {
      if (entries.length === 0) {
        return null;
      }

      const payload: TranscriptPayload[] = entries.map(({ id, role, text, status }) => {
        const normalizedStatus = typeof status === "string" ? status.trim() : "";
        const base: TranscriptPayload = {
          id,
          role,
          text,
        };
        if (normalizedStatus.length > 0) {
          base.status = normalizedStatus;
        }
        return base;
      });

      return { payload };
    },
    [],
  );

  const handleConnectionChange = useCallback(
    (value: "connected" | "connecting" | "disconnected") => {
      if (value === "connected") {
        setStatus("connected");
        setIsListening(true);
      } else if (value === "connecting") {
        setStatus("connecting");
      } else {
        setIsListening(false);
        setStatus("idle");
        currentSessionRef.current = null;
      }
    },
    [],
  );

  const handleAgentStart = useCallback(() => {
    setIsListening(true);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setIsListening(false);
  }, []);

  const handleTransportError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Erreur de connexion WebRTC";
      onError?.(message);
      setStatus("error");
    },
    [onError],
  );

  const handleSessionError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Erreur de session vocale";
      onError?.(message);
    },
    [onError],
  );

  const sendTranscripts = useCallback(
    async (options?: { force?: boolean }) => {
      if (!threadId || !token) {
        return;
      }

      const transcripts = conversationHistoryRef.current;
      if (transcripts.length === 0) {
        console.log("[WorkflowVoiceSession] No transcripts to send");
        submittedTranscriptSignaturesRef.current.clear();
        hasSubmittedUserRef.current = false;
        queuedSendRef.current = false;
        return;
      }

      const snapshot = createSnapshot(transcripts);
      if (!snapshot) {
        return;
      }

      const force = options?.force ?? false;
      const submittedMap = submittedTranscriptSignaturesRef.current;

      const entriesToSend = snapshot.payload.filter((entry) => {
        const signature = `${entry.role}:${entry.text}:${entry.status ?? ""}`;
        if (force) {
          return true;
        }
        const previous = submittedMap.get(entry.id);
        return previous !== signature;
      });

      if (!force && entriesToSend.length === 0) {
        return;
      }

      if (!force && !hasSubmittedUserRef.current) {
        const hasUserInPayload = entriesToSend.some((entry) => entry.role === "user");
        if (!hasUserInPayload) {
          return;
        }
      }

      if (entriesToSend.length === 0) {
        return;
      }

      if (uploadInFlightRef.current) {
        queuedSendRef.current = true;
        return;
      }

      uploadInFlightRef.current = true;
      queuedSendRef.current = false;

      try {
        console.log(
          "[WorkflowVoiceSession] Sending transcripts:",
          entriesToSend.length,
          "items",
        );

        const path = `/api/chatkit/voice/transcripts/${threadId}`;
        const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "";
        const endpoints = makeApiEndpointCandidates(backendUrl, path);

        let lastError: Error | null = null;
        for (const endpoint of endpoints) {
          const isRelative = endpoint.startsWith("/");
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ transcripts: entriesToSend }),
            });

            if (response.ok) {
              const result = await response.json();
              for (const entry of entriesToSend) {
                const signature = `${entry.role}:${entry.text}:${entry.status ?? ""}`;
                submittedMap.set(entry.id, signature);
                if (entry.role === "user") {
                  hasSubmittedUserRef.current = true;
                }
              }
              console.log(
                "[WorkflowVoiceSession] Transcripts sent successfully:",
                result,
              );

              onTranscriptsUpdated?.();

              lastError = null;
              break;
            }

            if (response.status === 404 && isRelative && endpoints.length > 1) {
              lastError = new Error(`Failed to send transcripts: ${response.status}`);
              continue;
            }

            if (response.status === 404) {
              console.info(
                "[WorkflowVoiceSession] Transcript upload skipped (no pending voice session)",
              );
              lastError = null;
              break;
            }

            throw new Error(`Failed to send transcripts: ${response.status}`);
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("Erreur réseau");
            if (!isRelative || endpoints.length === 1) {
              break;
            }
          }
        }

        if (lastError) {
          throw lastError;
        }
      } catch (error) {
        console.error("[WorkflowVoiceSession] Failed to send transcripts:", error);
        queuedSendRef.current = true;
        onError?.("Impossible d'envoyer les transcriptions");
      } finally {
        uploadInFlightRef.current = false;
        if (queuedSendRef.current) {
          queuedSendRef.current = false;
          void sendTranscripts();
        }
      }
    },
    [threadId, token, onError, onTranscriptsUpdated, createSnapshot],
  );

  const handleHistoryUpdated = useCallback(
    (history: RealtimeItem[]) => {
      // Collecter les transcriptions de la conversation vocale
      const transcriptsById = new Map<string, TranscriptEntry>();
      const order: string[] = [];

      for (const item of history) {
        if (item.type !== "message") {
          continue;
        }

        const role = item.role;
        if (role !== "user" && role !== "assistant") {
          continue;
        }

        // Ignorer les éléments non terminés pour éviter les doublons ou brouillons
        const statusRaw =
          typeof (item as { status?: unknown }).status === "string"
            ? ((item as { status: string }).status || "").trim()
            : undefined;
        if (statusRaw && statusRaw !== "completed") {
          continue;
        }

        const textParts: string[] = [];
        for (const part of item.content ?? []) {
          if (
            (part.type === "input_text" || part.type === "output_text") &&
            typeof part.text === "string" &&
            part.text.trim().length > 0
          ) {
            textParts.push(part.text.trim());
          } else if (
            (part.type === "input_audio" || part.type === "output_audio") &&
            typeof part.transcript === "string" &&
            part.transcript.trim().length > 0
          ) {
            textParts.push(part.transcript.trim());
          }
        }

        if (textParts.length > 0) {
          const text = textParts.join("\n");
          const identifier =
            typeof (item as { id?: unknown }).id === "string" &&
            (item as { id: string }).id.trim().length > 0
              ? (item as { id: string }).id
              : `${role}-${order.length}`;

          if (!transcriptsById.has(identifier)) {
            order.push(identifier);
          }

          transcriptsById.set(identifier, {
            id: identifier,
            role,
            text,
            status: statusRaw,
          });
        }
      }

      const transcripts = order
        .map((identifier) => transcriptsById.get(identifier))
        .filter((entry): entry is TranscriptEntry => Boolean(entry));

      conversationHistoryRef.current = transcripts;
      setTranscripts(transcripts);
      console.log("[WorkflowVoiceSession] History updated:", transcripts.length, "items");
      void sendTranscripts();
    },
    [sendTranscripts],
  );

  const { connect, disconnect } = useRealtimeSession({
    onHistoryUpdated: handleHistoryUpdated,
    onConnectionChange: handleConnectionChange,
    onAgentStart: handleAgentStart,
    onAgentEnd: handleAgentEnd,
    onTransportError: handleTransportError,
    onError: handleSessionError,
  });

  const startVoiceSession = useCallback(
    async (payload: VoiceSessionEventPayload) => {
      const eventPayload =
        payload.type === "realtime.event"
          ? payload.event
          : {
              type: "history" as const,
              session_id: undefined,
              client_secret: payload.client_secret,
              session: payload.session,
              tool_permissions: payload.tool_permissions,
            };

      const sessionId =
        eventPayload.session_id ?? `${payload.step.slug}-${Date.now()}`;

      // Éviter de démarrer la même session plusieurs fois
      if (processedSessionsRef.current.has(sessionId)) {
        console.debug("[WorkflowVoiceSession] Session already processed:", sessionId);
        return;
      }

      // Arrêter la session en cours si elle existe
      if (currentSessionRef.current) {
        console.debug("[WorkflowVoiceSession] Stopping current session before starting new one");
        disconnect();
      }

      processedSessionsRef.current.add(sessionId);
      currentSessionRef.current = sessionId;
      conversationHistoryRef.current = [];
      setTranscripts([]);
      submittedTranscriptSignaturesRef.current = new Map();
      hasSubmittedUserRef.current = false;
      queuedSendRef.current = false;
      uploadInFlightRef.current = false;

      setStatus("connecting");

      let stream: MediaStream | null = null;
      try {
        if (!token) {
          throw new Error("Authentification requise pour la session vocale.");
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("API microphone non disponible.");
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        console.log("[WorkflowVoiceSession] Starting voice session:", {
          step: payload.step,
          model: eventPayload.session.model,
          voice: eventPayload.session.voice,
        });

        await connect({ token, localStream: stream });
        setStatus("connected");
        setIsListening(true);
      } catch (error) {
        if (stream) {
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {
              /* noop */
            }
          });
        }
        disconnect();
        setIsListening(false);
        setStatus("error");
        if (error instanceof Error && error.message) {
          onError?.(error.message);
        }
        console.error("[WorkflowVoiceSession] Failed to start voice session:", error);
      }
    },
    [connect, disconnect, onError, token],
  );

  const stopVoiceSession = useCallback(async () => {
    // Finaliser la session vocale (déclencher la continuation du workflow)
    if (threadId && token) {
      try {
        const path = `/api/chatkit/voice/finalize/${threadId}`;
        const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "";
        const endpoints = makeApiEndpointCandidates(backendUrl, path);

        let finalized = false;
        for (const endpoint of endpoints) {
          const isRelative = endpoint.startsWith("/");
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ transcripts: [] }), // Les transcriptions ont déjà été envoyées
            });

            if (response.ok) {
              console.log("[WorkflowVoiceSession] Voice session finalized successfully");
              finalized = true;
              break;
            }

            if (response.status === 404 && isRelative && endpoints.length > 1) {
              continue;
            }

            if (response.status === 404) {
              console.info("[WorkflowVoiceSession] No pending voice session to finalize");
              finalized = true;
              break;
            }

            console.warn(`[WorkflowVoiceSession] Failed to finalize voice session: ${response.status}`);
            break;
          } catch (error) {
            console.error("[WorkflowVoiceSession] Error finalizing voice session:", error);
            if (!isRelative || endpoints.length === 1) {
              break;
            }
          }
        }

        if (!finalized) {
          console.warn("[WorkflowVoiceSession] Voice session could not be finalized");
        }
      } catch (error) {
        console.error("[WorkflowVoiceSession] Failed to finalize voice session:", error);
        if (error instanceof Error && error.message) {
          onError?.(error.message);
        }
      }
    }

    disconnect();
    setIsListening(false);
    setStatus("idle");
    currentSessionRef.current = null;
    conversationHistoryRef.current = [];
    setTranscripts([]);
    submittedTranscriptSignaturesRef.current.clear();
    hasSubmittedUserRef.current = false;
    queuedSendRef.current = false;
    uploadInFlightRef.current = false;
  }, [disconnect, threadId, token, onError]);

  // Poll for pending voice sessions
  useEffect(() => {
    if (!threadId || !token) {
      return;
    }

    const pollForVoiceSession = async () => {
      try {
        const response = await fetch(`/api/chatkit/voice/pending/${threadId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const event = (await response.json()) as VoiceSessionEventPayload;

          // Stop polling BEFORE starting session to prevent race condition
          if (pollingIntervalRef.current !== null) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          console.log("[WorkflowVoiceSession] Pending voice session detected:", event);
          await startVoiceSession(event);
        } else if (response.status !== 404) {
          // Log errors other than "not found"
          console.warn(
            "[WorkflowVoiceSession] Error polling for voice session:",
            response.status,
          );
        }
      } catch (error) {
        console.error("[WorkflowVoiceSession] Error polling for voice session:", error);
      }
    };

    // Poll immediately
    void pollForVoiceSession();

    // Then poll periodically
    pollingIntervalRef.current = window.setInterval(() => {
      void pollForVoiceSession();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [threadId, token, startVoiceSession]);

  // Nettoyer à la fin
  useEffect(
    () => () => {
      disconnect();
    },
    [disconnect],
  );

  return {
    stopVoiceSession,
    status,
    isListening,
    transcripts,
  };
};

export type { UseWorkflowVoiceSessionParams, VoiceSessionStatus, TranscriptEntry };
