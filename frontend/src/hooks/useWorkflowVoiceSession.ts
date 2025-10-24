import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth";
import { useRealtimeSession } from "../voice/useRealtimeSession";
import type { VoiceSessionSecret } from "../voice/useVoiceSecret";

type VoiceSessionStatus = "idle" | "connecting" | "connected" | "error";

type VoiceSessionEventPayload = {
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
};

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

const resolveApiKey = (
  clientSecret: string | { value: string; expires_at: number },
): string | null => {
  if (typeof clientSecret === "string") {
    return clientSecret;
  }
  if (clientSecret && typeof clientSecret === "object" && "value" in clientSecret) {
    const { value } = clientSecret;
    return typeof value === "string" ? value : null;
  }
  return null;
};

const resolveExpiresAt = (
  clientSecret: string | { value: string; expires_at: number },
): number => {
  if (
    clientSecret &&
    typeof clientSecret === "object" &&
    "expires_at" in clientSecret &&
    typeof clientSecret.expires_at === "number"
  ) {
    return clientSecret.expires_at * 1000; // Convert to milliseconds
  }
  return Date.now() + 60000; // Default to 1 minute
};

export const useWorkflowVoiceSession = ({
  threadId,
  onError,
}: UseWorkflowVoiceSessionParams) => {
  const { token } = useAuth();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const processedSessionsRef = useRef<Set<string>>(new Set());
  const currentSessionRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const conversationHistoryRef = useRef<Array<{ role: string; text: string }>>([]);
  const transcriptsSentRef = useRef(false);

  const handleHistoryUpdated = useCallback(
    (history: Array<{ role?: string; formatted?: { transcript?: string; text?: string } }>) => {
      // Collecter les transcriptions de la conversation vocale
      const transcripts: Array<{ role: string; text: string }> = [];

      for (const item of history) {
        const role = item.role;
        const text = item.formatted?.transcript || item.formatted?.text;

        if (role && text && (role === "user" || role === "assistant")) {
          transcripts.push({ role, text });
        }
      }

      conversationHistoryRef.current = transcripts;
      console.log("[WorkflowVoiceSession] History updated:", transcripts.length, "items");
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
      const sessionId = `${payload.step.slug}-${Date.now()}`;

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
      transcriptsSentRef.current = false;

      setStatus("connecting");

      try {
        const apiKey = resolveApiKey(payload.client_secret);
        if (!apiKey) {
          throw new Error("Secret client invalide dans l'événement voice_session.created");
        }

        const expiresAt = resolveExpiresAt(payload.client_secret);

        const secret: VoiceSessionSecret = {
          client_secret: apiKey,
          model: payload.session.model,
          voice: payload.session.voice,
          instructions: payload.session.instructions,
          expires_at: expiresAt,
        };

        console.log("[WorkflowVoiceSession] Starting voice session:", {
          step: payload.step,
          model: secret.model,
          voice: secret.voice,
        });

        await connect({ secret, apiKey });
        setStatus("connected");
        setIsListening(true);
      } catch (error) {
        disconnect();
        setIsListening(false);
        setStatus("error");
        const message =
          error instanceof Error ? error.message : "Impossible de démarrer la session vocale";
        onError?.(message);
        console.error("[WorkflowVoiceSession] Failed to start voice session:", error);
      }
    },
    [connect, disconnect, onError],
  );

  const sendTranscripts = useCallback(async () => {
    if (!threadId || !token || transcriptsSentRef.current) {
      return;
    }

    const transcripts = conversationHistoryRef.current;
    if (transcripts.length === 0) {
      console.log("[WorkflowVoiceSession] No transcripts to send");
      return;
    }

    transcriptsSentRef.current = true;

    try {
      console.log("[WorkflowVoiceSession] Sending transcripts:", transcripts.length, "items");

      const response = await fetch(`/api/chatkit/voice/transcripts/${threadId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transcripts }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send transcripts: ${response.status}`);
      }

      const result = await response.json();
      console.log("[WorkflowVoiceSession] Transcripts sent successfully:", result);
    } catch (error) {
      console.error("[WorkflowVoiceSession] Failed to send transcripts:", error);
      transcriptsSentRef.current = false; // Réessayer si échec
      onError?.("Impossible d'envoyer les transcriptions");
    }
  }, [threadId, token, onError]);

  const stopVoiceSession = useCallback(async () => {
    // Envoyer les transcriptions avant de déconnecter
    await sendTranscripts();

    disconnect();
    setIsListening(false);
    setStatus("idle");
    currentSessionRef.current = null;
    conversationHistoryRef.current = [];
    transcriptsSentRef.current = false;
  }, [disconnect, sendTranscripts]);

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
  };
};

export type { UseWorkflowVoiceSessionParams, VoiceSessionStatus };
