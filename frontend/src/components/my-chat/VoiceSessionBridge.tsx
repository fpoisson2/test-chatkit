import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { useRealtimeSession } from "../../voice/useRealtimeSession";
import type { VoiceSessionSecret } from "../../voice/useVoiceSecret";
import { resolveVoiceSessionApiKey } from "../../voice/useVoiceSession";
import type { RealtimeItem, RealtimeMessageItem } from "@openai/agents/realtime";

export type VoiceSessionDetails = {
  taskId: string;
  stepSlug: string | null;
  stepTitle: string | null;
  clientSecret: unknown;
  session: {
    model: string;
    voice: string;
    instructions: string;
    prompt_id: string | null;
    prompt_version: string | null;
    prompt_variables?: Record<string, string>;
  };
  realtime: {
    startMode: "manual" | "auto";
    stopMode: "manual" | "auto";
  } | null;
  toolPermissions: Record<string, boolean>;
};

type VoiceSessionBridgeProps = {
  details: VoiceSessionDetails;
  onReset: () => void;
  threadId: string | null;
  sendCustomAction: ((
    action: { type: string; payload?: Record<string, unknown> },
    itemId?: string,
  ) => Promise<void>) | null;
};

type VoiceTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "in_progress" | "completed" | "incomplete";
};

type VoiceSessionStatus = "idle" | "connecting" | "connected" | "error";

const TOOL_ORDER = ["response", "transcription", "function_call"] as const;

type BridgeErrorCode = "microphone_denied" | "media_unavailable";

type BridgeError = Error & { code?: BridgeErrorCode };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractClientSecretValue = (
  payload: unknown,
  visited = new Set<unknown>(),
): string | { value?: string } | null => {
  if (typeof payload === "string") {
    return payload;
  }
  if (!isRecord(payload) || visited.has(payload)) {
    return null;
  }
  visited.add(payload);

  if ("value" in payload) {
    const raw = payload.value;
    if (typeof raw === "string") {
      return { value: raw };
    }
    const nested = extractClientSecretValue(raw, visited);
    if (nested) {
      return nested;
    }
  }

  for (const key of ["client_secret", "clientSecret"]) {
    if (key in payload) {
      const candidate = extractClientSecretValue(payload[key], visited);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
};

const extractExpiration = (
  payload: unknown,
  visited = new Set<unknown>(),
): string | null => {
  if (!isRecord(payload) || visited.has(payload)) {
    return null;
  }

  visited.add(payload);

  for (const key of ["expires_at", "expiresAt"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  for (const value of Object.values(payload)) {
    if (typeof value === "object" && value !== null) {
      const nested = extractExpiration(value, visited);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
};

const cloneSerializableRecord = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  try {
    const cloned = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    return Object.keys(cloned).length > 0 ? cloned : undefined;
  } catch (error) {
    console.warn("[ChatKit] Impossible de cloner l'objet Realtime", error);
    return undefined;
  }
};

const extractRealtimeSessionConfig = (
  payload: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const session = isRecord(payload.session)
    ? (payload.session as Record<string, unknown>)
    : payload;

  if (!isRecord(session)) {
    return undefined;
  }

  return cloneSerializableRecord(session);
};

const buildVoiceSessionSecret = (
  details: VoiceSessionDetails,
): VoiceSessionSecret | null => {
  const clientSecret = extractClientSecretValue(details.clientSecret);
  if (!clientSecret) {
    return null;
  }

  const expiresAt = extractExpiration(details.clientSecret);
  const { session } = details;

  const promptVariables = session.prompt_variables;
  let sessionConfig = extractRealtimeSessionConfig(details.clientSecret);

  const realtimeUpdate = (() => {
    const update: Record<string, unknown> = {};

    if (details.realtime) {
      if (details.realtime.startMode) {
        update.start_mode = details.realtime.startMode;
      }
      if (details.realtime.stopMode) {
        update.stop_mode = details.realtime.stopMode;
      }
    }

    const normalizedTools: Record<string, boolean> = {};
    Object.entries(details.toolPermissions).forEach(([key, allowed]) => {
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        return;
      }
      normalizedTools[trimmedKey] = Boolean(allowed);
    });
    if (Object.keys(normalizedTools).length > 0) {
      update.tools = normalizedTools;
    }

    return Object.keys(update).length > 0 ? update : undefined;
  })();

  if (realtimeUpdate) {
    const baseRealtime =
      sessionConfig && isRecord(sessionConfig["realtime"])
        ? { ...(sessionConfig["realtime"] as Record<string, unknown>) }
        : undefined;
    const mergedRealtime = baseRealtime ? { ...baseRealtime, ...realtimeUpdate } : realtimeUpdate;
    sessionConfig = sessionConfig
      ? { ...sessionConfig, realtime: mergedRealtime }
      : { realtime: mergedRealtime };
  }

  return {
    client_secret: clientSecret,
    expires_at: expiresAt ?? undefined,
    instructions: session.instructions || "",
    model: session.model || "gpt-4o-realtime-preview",
    voice: session.voice || "alloy",
    prompt_id: session.prompt_id,
    prompt_version: session.prompt_version,
    prompt_variables: promptVariables && Object.keys(promptVariables).length > 0 ? promptVariables : undefined,
    session_config: sessionConfig,
  } satisfies VoiceSessionSecret;
};

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
};

const isMessageItem = (item: RealtimeItem): item is RealtimeMessageItem => item.type === "message";

const collectTextFromMessage = (item: RealtimeMessageItem): string => {
  return item.content
    .map((part) => {
      if (part.type === "input_text" || part.type === "output_text") {
        return part.text;
      }
      if ("transcript" in part && part.transcript) {
        return part.transcript;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
};

const extractTranscriptsFromHistory = (history: RealtimeItem[]): VoiceTranscriptEntry[] => {
  return history
    .filter(isMessageItem)
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      id: item.itemId,
      role: item.role as "user" | "assistant",
      text: collectTextFromMessage(item),
      status: item.status,
    }))
    .filter((entry) => entry.text);
};

export const VoiceSessionBridge = ({
  details,
  onReset,
  threadId,
  sendCustomAction,
}: VoiceSessionBridgeProps) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<VoiceSessionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<VoiceTranscriptEntry[]>([]);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);

  const transcriptsRef = useRef<VoiceTranscriptEntry[]>([]);
  const sentTranscriptIdsRef = useRef<Set<string>>(new Set());
  const pendingTranscriptIdsRef = useRef<Set<string>>(new Set());
  const finalizingRef = useRef(false);
  const microphonePreflightRef = useRef(false);
  const hasRequestedGreetingRef = useRef(false);
  const finalizeOnDisconnectRef = useRef(false);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    hasRequestedGreetingRef.current = false;
  }, [details.taskId]);

  useEffect(() => {
    setNeedsUserGesture(false);
  }, [details.taskId]);

  const voiceSecret = useMemo<VoiceSessionSecret | null>(() => {
    const secret = buildVoiceSessionSecret(details);
    if (!secret) {
      console.error("[ChatKit][VoiceBridge] Impossible de construire le secret Realtime", {
        taskId: details.taskId,
        stepSlug: details.stepSlug,
      });
      return null;
    }

    const realtimeKeys =
      secret.session_config && isRecord(secret.session_config["realtime"])
        ? Object.keys(secret.session_config["realtime"] as Record<string, unknown>)
        : [];

    console.info("[ChatKit][VoiceBridge] Secret Realtime construit", {
      taskId: details.taskId,
      stepSlug: details.stepSlug,
      stepTitle: details.stepTitle,
      model: secret.model,
      voice: secret.voice,
      sessionConfigKeys: secret.session_config ? Object.keys(secret.session_config) : [],
      realtimeKeys,
      startMode: details.realtime?.startMode ?? null,
      stopMode: details.realtime?.stopMode ?? null,
      toolPermissions: details.toolPermissions,
    });

    return secret;
  }, [details]);

  const toolEntries = useMemo(() => {
    const entries = Object.entries(details.toolPermissions).map(([key, allowed]) => ({
      key,
      allowed: Boolean(allowed),
    }));

    entries.sort((a, b) => {
      const indexA = TOOL_ORDER.indexOf(a.key as (typeof TOOL_ORDER)[number]);
      const indexB = TOOL_ORDER.indexOf(b.key as (typeof TOOL_ORDER)[number]);

      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      if (indexA !== -1) {
        return -1;
      }
      if (indexB !== -1) {
        return 1;
      }
      return a.key.localeCompare(b.key);
    });

    return entries;
  }, [details.toolPermissions]);

  const submitTranscripts = useCallback(
    async (
      entries: VoiceTranscriptEntry[],
      { final = false, reason }: { final?: boolean; reason?: "agent_end" | "manual" } = {},
    ) => {
      if (!sendCustomAction) {
        console.warn("[ChatKit] Impossible d'envoyer les transcriptions vocales sans action personnalisée.");
        return;
      }
      if (!threadId) {
        console.warn("[ChatKit] Impossible d'envoyer les transcriptions vocales sans fil actif.");
        return;
      }
      if (!final && entries.length === 0) {
        return;
      }

      const payload: Record<string, unknown> = {
        transcripts: entries.map((entry) => ({
          role: entry.role,
          text: entry.text,
          status: entry.status,
        })),
        step_slug: details.stepSlug ?? undefined,
        task_id: details.taskId,
        append: !final,
        final,
      };

      if (reason === "manual") {
        payload.interrupted = true;
      }

      console.info("[ChatKit][VoiceBridge] Envoi des transcriptions", {
        taskId: details.taskId,
        count: entries.length,
        final,
        reason: reason ?? null,
      });

      try {
        await sendCustomAction({ type: "workflow.voice_transcripts", payload });
        if (final) {
          entries.forEach((entry) => sentTranscriptIdsRef.current.add(entry.id));
          pendingTranscriptIdsRef.current.clear();
        } else {
          entries.forEach((entry) => {
            sentTranscriptIdsRef.current.add(entry.id);
            pendingTranscriptIdsRef.current.delete(entry.id);
          });
        }
      } catch (err) {
        console.error("[ChatKit][VoiceBridge] Erreur lors de l'envoi des transcriptions", {
          taskId: details.taskId,
          count: entries.length,
          final,
          reason: reason ?? null,
          error: err,
        });
        entries.forEach((entry) => pendingTranscriptIdsRef.current.delete(entry.id));
        throw err;
      }
    },
    [details.stepSlug, details.taskId, sendCustomAction, threadId],
  );

  const handleHistoryUpdated = useCallback(
    (history: RealtimeItem[]) => {
      const next = extractTranscriptsFromHistory(history);
      setTranscripts(next);
      transcriptsRef.current = next;

      console.info("[ChatKit][VoiceBridge] Historique Realtime mis à jour", {
        taskId: details.taskId,
        entries: next.length,
      });

      const completed = next.filter((entry) => entry.status === "completed");
      const unsent = completed.filter(
        (entry) =>
          !sentTranscriptIdsRef.current.has(entry.id) &&
          !pendingTranscriptIdsRef.current.has(entry.id),
      );

      if (unsent.length > 0) {
        unsent.forEach((entry) => pendingTranscriptIdsRef.current.add(entry.id));
        void submitTranscripts(unsent).catch((err) => {
          const message =
            err instanceof Error
              ? err.message
              : t("voice.inline.errors.submitFailed");
          console.error("[ChatKit][VoiceBridge] Soumission automatique des transcriptions échouée", {
            taskId: details.taskId,
            error: err,
          });
          setError(message);
        });
      }
    },
    [details.taskId, submitTranscripts, t],
  );

  const flushTranscripts = useCallback(
    async (reason: "agent_end" | "manual") => {
      if (finalizingRef.current) {
        return;
      }
      finalizingRef.current = true;
      try {
        console.info("[ChatKit][VoiceBridge] Flush des transcriptions demandé", {
          taskId: details.taskId,
          reason,
        });
        const current = transcriptsRef.current;
        const completed = current.filter((entry) => entry.status === "completed");
        const unsent = completed.filter(
          (entry) => !sentTranscriptIdsRef.current.has(entry.id),
        );

        if (unsent.length > 0) {
          unsent.forEach((entry) => pendingTranscriptIdsRef.current.add(entry.id));
          try {
            console.info("[ChatKit][VoiceBridge] Envoi des transcriptions en attente avant finalisation", {
              taskId: details.taskId,
              count: unsent.length,
            });
            await submitTranscripts(unsent);
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : t("voice.inline.errors.submitFailed");
            console.error("[ChatKit][VoiceBridge] Échec lors du vidage des transcriptions en attente", {
              taskId: details.taskId,
              error: err,
            });
            setError(message);
            return;
          }
        }

        if (completed.length === 0) {
          console.info("[ChatKit][VoiceBridge] Aucune transcription finalisée à envoyer", {
            taskId: details.taskId,
            reason,
          });
          onReset();
          return;
        }

        try {
          console.info("[ChatKit][VoiceBridge] Finalisation des transcriptions", {
            taskId: details.taskId,
            count: completed.length,
            reason,
          });
          await submitTranscripts(completed, { final: true, reason });
          onReset();
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : t("voice.inline.errors.submitFailed");
          console.error("[ChatKit][VoiceBridge] Impossible de finaliser les transcriptions", {
            taskId: details.taskId,
            error: err,
          });
          setError(message);
        }
      } finally {
        finalizingRef.current = false;
      }
    },
    [details.taskId, onReset, submitTranscripts, t],
  );

  const ensureMicrophoneAccess = useCallback(async () => {
    if (microphonePreflightRef.current) {
      return;
    }

    if (typeof navigator === "undefined") {
      throw new Error(t("voice.inline.errors.mediaUnavailable"));
    }

    const { mediaDevices } = navigator;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      throw new Error(t("voice.inline.errors.mediaUnavailable"));
    }

    try {
      console.info("[ChatKit][VoiceBridge] Demande d'accès au microphone", {
        taskId: details.taskId,
      });
      const stream = await mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignorer les erreurs de nettoyage du micro : le navigateur s'en charge.
        }
      });
      microphonePreflightRef.current = true;
      console.info("[ChatKit][VoiceBridge] Accès au microphone accordé", {
        taskId: details.taskId,
      });
    } catch (err) {
      console.warn("[ChatKit][VoiceBridge] Échec de l'accès au microphone", {
        taskId: details.taskId,
        error: err,
      });
      if (err instanceof DOMException) {
        const { name } = err;
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw Object.assign(new Error(t("voice.inline.errors.microphoneDenied")), {
            code: "microphone_denied" as const,
          });
        }
        if (name === "NotFoundError" || name === "OverconstrainedError") {
          throw Object.assign(new Error(t("voice.inline.errors.mediaUnavailable")), {
            code: "media_unavailable" as const,
          });
        }
      }
      throw err;
    }
  }, [details.taskId, t]);

  const { connect, disconnect, startResponse } = useRealtimeSession({
    onHistoryUpdated: handleHistoryUpdated,
    onConnectionChange: (connectionStatus) => {
      console.info("[ChatKit][VoiceBridge] Changement de statut Realtime", {
        taskId: details.taskId,
        status: connectionStatus,
      });
      if (connectionStatus === "connected") {
        setStatus("connected");
      } else if (connectionStatus === "connecting") {
        setStatus("connecting");
      } else {
        setStatus((current) => (current === "error" ? current : "idle"));
        if (finalizeOnDisconnectRef.current) {
          finalizeOnDisconnectRef.current = false;
          void flushTranscripts("agent_end");
        }
      }
    },
    onAgentEnd: () => {
      console.info("[ChatKit][VoiceBridge] Agent Realtime terminé", {
        taskId: details.taskId,
      });
      setStatus("idle");
    },
    onTransportError: (transportError) => {
      const message = formatErrorMessage(transportError) || t("voice.inline.errors.generic");
      console.error("[ChatKit][VoiceBridge] Erreur de transport Realtime", {
        taskId: details.taskId,
        error: transportError,
      });
      setError(message);
      setStatus("error");
    },
    onError: (sessionError) => {
      const message = formatErrorMessage(sessionError) || t("voice.inline.errors.generic");
      console.error("[ChatKit][VoiceBridge] Erreur Realtime", {
        taskId: details.taskId,
        error: sessionError,
      });
      setError(message);
      setStatus("error");
    },
  });

  const requestInitialResponse = useCallback(() => {
    if (!details.toolPermissions.response) {
      return;
    }
    if (hasRequestedGreetingRef.current) {
      return;
    }
    console.info("[ChatKit][VoiceBridge] Demande de réponse initiale", {
      taskId: details.taskId,
    });
    const started = startResponse();
    if (started) {
      hasRequestedGreetingRef.current = true;
    }
  }, [details.taskId, details.toolPermissions.response, startResponse]);

  const beginSession = useCallback(
    async (mode: "auto" | "manual") => {
      if (!voiceSecret) {
        setStatus("error");
        setError(t("voice.inline.errors.invalidSecret"));
        console.error("[ChatKit][VoiceBridge] Aucun secret Realtime disponible", {
          taskId: details.taskId,
          mode,
        });
        return;
      }

      hasRequestedGreetingRef.current = false;
      setError(null);
      setStatus("connecting");
      setTranscripts([]);
      transcriptsRef.current = [];
      sentTranscriptIdsRef.current.clear();
      pendingTranscriptIdsRef.current.clear();
      finalizingRef.current = false;
      finalizeOnDisconnectRef.current = false;

      try {
        console.info("[ChatKit][VoiceBridge] Démarrage de la session Realtime", {
          taskId: details.taskId,
          mode,
          startMode: details.realtime?.startMode ?? null,
          stopMode: details.realtime?.stopMode ?? null,
        });
        await ensureMicrophoneAccess();

        const apiKey = resolveVoiceSessionApiKey(voiceSecret.client_secret);
        if (!apiKey) {
          throw new Error(t("voice.inline.errors.invalidSecret"));
        }

        await connect({ secret: voiceSecret, apiKey });
        console.info("[ChatKit][VoiceBridge] Session Realtime connectée", {
          taskId: details.taskId,
          mode,
          model: voiceSecret.model,
          voice: voiceSecret.voice,
        });
        setStatus("connected");
        setNeedsUserGesture(false);
        finalizeOnDisconnectRef.current = true;
      } catch (err) {
        disconnect();
        console.error("[ChatKit][VoiceBridge] Échec du démarrage de la session Realtime", {
          taskId: details.taskId,
          mode,
          error: err,
        });
        const bridgeError = err as BridgeError;
        const fallback = t("voice.inline.errors.generic");
        const message = formatErrorMessage(err) || fallback;

        if (bridgeError?.code === "microphone_denied") {
          setNeedsUserGesture(true);
          setStatus(mode === "auto" ? "idle" : "error");
          setError(message);
          return;
        }

        if (bridgeError?.code === "media_unavailable") {
          setNeedsUserGesture(false);
          setStatus("error");
          setError(message);
          return;
        }

        setNeedsUserGesture(false);
        setStatus("error");
        setError(message);
      }
    },
    [
      connect,
      details.realtime?.startMode,
      details.realtime?.stopMode,
      details.taskId,
      disconnect,
      ensureMicrophoneAccess,
      t,
      voiceSecret,
    ],
  );

  useEffect(() => {
    if (!voiceSecret) {
      setStatus("error");
      setError(t("voice.inline.errors.invalidSecret"));
      return () => {
        finalizeOnDisconnectRef.current = false;
        disconnect();
      };
    }

    void beginSession("auto");

    return () => {
      finalizeOnDisconnectRef.current = false;
      disconnect();
    };
  }, [beginSession, disconnect, t, voiceSecret]);

  const handleStop = useCallback(() => {
    console.info("[ChatKit][VoiceBridge] Arrêt manuel demandé", {
      taskId: details.taskId,
    });
    finalizeOnDisconnectRef.current = false;
    disconnect();
    void flushTranscripts("manual");
    setNeedsUserGesture(false);
  }, [details.taskId, disconnect, flushTranscripts]);

  const handleManualStart = useCallback(() => {
    setNeedsUserGesture(false);
    console.info("[ChatKit][VoiceBridge] Relance manuelle de la session", {
      taskId: details.taskId,
    });
    void beginSession("manual");
  }, [beginSession, details.taskId]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "connected":
        return t("voice.inline.status.connected");
      case "connecting":
        return t("voice.inline.status.connecting");
      case "error":
        return t("voice.inline.status.error");
      default:
        return t("voice.inline.status.idle");
    }
  }, [status, t]);

  useEffect(() => {
    if (status === "connected") {
      requestInitialResponse();
    }
  }, [requestInitialResponse, status]);

  const statusClassName = useMemo(() => {
    switch (status) {
      case "connected":
        return "voice-chat__badge--connected";
      case "connecting":
        return "voice-chat__badge--connecting";
      case "error":
        return "voice-chat__badge--error";
      default:
        return "voice-chat__badge--idle";
    }
  }, [status]);

  const toolLabelKey: Record<string, string> = {
    response: "workflowBuilder.voiceInspector.tool.response",
    transcription: "workflowBuilder.voiceInspector.tool.transcription",
    function_call: "workflowBuilder.voiceInspector.tool.functionCall",
  };

  const heading = details.stepTitle?.trim() || t("voice.title");
  const subtitle = t("voice.inline.subtitle");
  const modelVoice = t("voice.inline.modelVoice", {
    model: details.session.model || "—",
    voice: details.session.voice || "—",
  });
  const showStartButton = needsUserGesture;

  return (
    <section className="voice-session-panel" aria-live="polite">
      <header className="voice-session-panel__header">
        <div className="voice-session-panel__heading">
          <h2 className="voice-session-panel__title">{heading}</h2>
          <p className="voice-session-panel__subtitle">{subtitle}</p>
        </div>
        <div className="voice-session-panel__actions">
          {showStartButton && (
            <button
              type="button"
              className="button"
              onClick={() => {
                handleManualStart();
              }}
              disabled={status === "connecting"}
            >
              {t("voice.inline.start")}
            </button>
          )}
          <button
            type="button"
            className="button button--ghost"
            onClick={handleStop}
          >
            {t("voice.inline.stop")}
          </button>
        </div>
      </header>

      <div className="voice-session-panel__status">
        <span className={`voice-chat__badge ${statusClassName}`}>{statusLabel}</span>
        <span className="voice-chat__badge voice-chat__badge--secondary">{modelVoice}</span>
      </div>

      {error && (
        <div className="alert alert--danger" role="status">
          {error}
        </div>
      )}

      <div className="voice-session-panel__tools">
        <h3 className="voice-session-panel__tools-title">{t("voice.inline.toolsTitle")}</h3>
        {toolEntries.length === 0 ? (
          <p className="voice-session-panel__tools-empty">{t("voice.inline.noTools")}</p>
        ) : (
          <ul className="voice-session-panel__tools-list">
            {toolEntries.map(({ key, allowed }) => {
              const label = toolLabelKey[key] ? t(toolLabelKey[key]) : key;
              return (
                <li key={key} className="voice-session-panel__tool-row">
                  <span className="voice-session-panel__tool-name">{label}</span>
                  <span
                    className={`voice-chat__badge ${allowed ? "voice-chat__badge--success" : "voice-chat__badge--secondary"}`}
                  >
                    {allowed
                      ? t("voice.inline.toolAllowed")
                      : t("voice.inline.toolBlocked")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

export default VoiceSessionBridge;

