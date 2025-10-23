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

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined;
  }
  return Number.isFinite(value) ? value : undefined;
};

const normalizeTurnDetection = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  if (typeof value.type === "string" && value.type.trim()) {
    result.type = value.type;
  }

  const threshold = toFiniteNumber(value.threshold);
  if (typeof threshold === "number") {
    result.threshold = threshold;
  }

  const prefixPadding = toFiniteNumber(
    value.prefixPaddingMs ?? value.prefix_padding_ms,
  );
  if (typeof prefixPadding === "number") {
    result.prefixPaddingMs = prefixPadding;
  }

  const silenceDuration = toFiniteNumber(
    value.silenceDurationMs ?? value.silence_duration_ms,
  );
  if (typeof silenceDuration === "number") {
    result.silenceDurationMs = silenceDuration;
  }

  const idleTimeout = toFiniteNumber(
    value.idleTimeoutMs ?? value.idle_timeout_ms,
  );
  if (typeof idleTimeout === "number") {
    result.idleTimeoutMs = idleTimeout;
  }

  const createResponse = value.createResponse ?? value.create_response;
  if (typeof createResponse === "boolean") {
    result.createResponse = createResponse;
  }

  const interruptResponse =
    value.interruptResponse ?? value.interrupt_response;
  if (typeof interruptResponse === "boolean") {
    result.interruptResponse = interruptResponse;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeAudioInput = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  if (value.format && typeof value.format === "object") {
    result.format = value.format;
  }

  if (value.transcription !== undefined) {
    result.transcription = value.transcription;
  }

  if (value.noiseReduction !== undefined) {
    result.noiseReduction = value.noiseReduction;
  } else if (value.noise_reduction !== undefined) {
    result.noiseReduction = value.noise_reduction;
  }

  const turnDetection = normalizeTurnDetection(
    value.turnDetection ?? value.turn_detection,
  );
  if (turnDetection) {
    result.turnDetection = turnDetection;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeAudioOutput = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  if (value.format && typeof value.format === "object") {
    result.format = value.format;
  }

  const voice = typeof value.voice === "string" ? value.voice.trim() : "";
  if (voice) {
    result.voice = voice;
  }

  const speed = toFiniteNumber(value.speed);
  if (typeof speed === "number") {
    result.speed = speed;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeAudioConfig = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const input = normalizeAudioInput(value.input);
  const output = normalizeAudioOutput(value.output);

  if (!input && !output) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  if (input) {
    result.input = input;
  }
  if (output) {
    result.output = output;
  }
  return result;
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

  const config: Record<string, unknown> = {};

  const model = typeof session.model === "string" ? session.model.trim() : "";
  if (model) {
    config.model = model;
  }

  const instructions =
    typeof session.instructions === "string"
      ? session.instructions.trim()
      : "";
  if (instructions) {
    config.instructions = instructions;
  }

  const toolChoiceRaw = session.toolChoice ?? session.tool_choice;
  const toolChoice =
    typeof toolChoiceRaw === "string" ? toolChoiceRaw.trim() : "";
  if (toolChoice) {
    config.toolChoice = toolChoice;
  }

  const tools = session.tools;
  if (Array.isArray(tools)) {
    config.tools = tools;
  }

  const outputModalities =
    session.outputModalities ?? session.output_modalities;
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    config.outputModalities = outputModalities;
  }

  const audio = normalizeAudioConfig(session.audio);
  if (audio) {
    config.audio = audio;
  }

  const voice = typeof session.voice === "string" ? session.voice.trim() : "";
  if (voice) {
    config.voice = voice;
  }

  return Object.keys(config).length > 0 ? config : undefined;
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
  const sessionConfig = extractRealtimeSessionConfig(details.clientSecret);

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

  const transcriptsRef = useRef<VoiceTranscriptEntry[]>([]);
  const sentTranscriptIdsRef = useRef<Set<string>>(new Set());
  const pendingTranscriptIdsRef = useRef<Set<string>>(new Set());
  const finalizingRef = useRef(false);
  const microphonePreflightRef = useRef(false);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  const voiceSecret = useMemo<VoiceSessionSecret | null>(
    () => buildVoiceSessionSecret(details),
    [details],
  );

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
          setError(message);
        });
      }
    },
    [submitTranscripts, t],
  );

  const flushTranscripts = useCallback(
    async (reason: "agent_end" | "manual") => {
      if (finalizingRef.current) {
        return;
      }
      finalizingRef.current = true;
      try {
        const current = transcriptsRef.current;
        const completed = current.filter((entry) => entry.status === "completed");
        const unsent = completed.filter(
          (entry) => !sentTranscriptIdsRef.current.has(entry.id),
        );

        if (unsent.length > 0) {
          unsent.forEach((entry) => pendingTranscriptIdsRef.current.add(entry.id));
          try {
            await submitTranscripts(unsent);
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : t("voice.inline.errors.submitFailed");
            setError(message);
            return;
          }
        }

        if (completed.length === 0) {
          onReset();
          return;
        }

        try {
          await submitTranscripts(completed, { final: true, reason });
          onReset();
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : t("voice.inline.errors.submitFailed");
          setError(message);
        }
      } finally {
        finalizingRef.current = false;
      }
    },
    [onReset, submitTranscripts, t],
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
      const stream = await mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignorer les erreurs de nettoyage du micro : le navigateur s'en charge.
        }
      });
      microphonePreflightRef.current = true;
    } catch (err) {
      if (err instanceof DOMException) {
        const { name } = err;
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw new Error(t("voice.inline.errors.microphoneDenied"));
        }
        if (name === "NotFoundError" || name === "OverconstrainedError") {
          throw new Error(t("voice.inline.errors.mediaUnavailable"));
        }
      }
      throw err;
    }
  }, [t]);

  const { connect, disconnect } = useRealtimeSession({
    onHistoryUpdated: handleHistoryUpdated,
    onConnectionChange: (connectionStatus) => {
      if (connectionStatus === "connected") {
        setStatus("connected");
      } else if (connectionStatus === "connecting") {
        setStatus("connecting");
      } else {
        setStatus((current) => (current === "error" ? current : "idle"));
      }
    },
    onAgentEnd: () => {
      setStatus("idle");
      void flushTranscripts("agent_end");
    },
    onTransportError: (transportError) => {
      const message = formatErrorMessage(transportError) || t("voice.inline.errors.generic");
      setError(message);
      setStatus("error");
    },
    onError: (sessionError) => {
      const message = formatErrorMessage(sessionError) || t("voice.inline.errors.generic");
      setError(message);
      setStatus("error");
    },
  });

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (!voiceSecret) {
        setStatus("error");
        setError(t("voice.inline.errors.invalidSecret"));
        return;
      }

      setError(null);
      setStatus("connecting");
      setTranscripts([]);
      transcriptsRef.current = [];
      sentTranscriptIdsRef.current.clear();
      pendingTranscriptIdsRef.current.clear();
      finalizingRef.current = false;

      try {
        await ensureMicrophoneAccess();

        const apiKey = resolveVoiceSessionApiKey(voiceSecret.client_secret);
        if (!apiKey) {
          throw new Error(t("voice.inline.errors.invalidSecret"));
        }

        await connect({ secret: voiceSecret, apiKey });

        if (!cancelled) {
          setStatus("connected");
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const fallback = t("voice.inline.errors.generic");
        const message = formatErrorMessage(err) || fallback;
        setError(message);
        setStatus("error");
      }
    };

    void start();

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [connect, disconnect, ensureMicrophoneAccess, t, voiceSecret]);

  const handleStop = useCallback(() => {
    disconnect();
    void flushTranscripts("manual");
  }, [disconnect, flushTranscripts]);

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

  return (
    <section className="voice-session-panel" aria-live="polite">
      <header className="voice-session-panel__header">
        <div className="voice-session-panel__heading">
          <h2 className="voice-session-panel__title">{heading}</h2>
          <p className="voice-session-panel__subtitle">{subtitle}</p>
        </div>
        <div className="voice-session-panel__actions">
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

