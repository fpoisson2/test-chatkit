import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { useRealtimeSession } from "../../voice/useRealtimeSession";
import type { VoiceSessionSecret } from "../../voice/useVoiceSecret";
import { resolveVoiceSessionApiKey } from "../../voice/useVoiceSession";

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

  return {
    client_secret: clientSecret,
    expires_at: expiresAt ?? undefined,
    instructions: session.instructions || "",
    model: session.model || "gpt-4o-realtime-preview",
    voice: session.voice || "alloy",
    prompt_id: session.prompt_id,
    prompt_version: session.prompt_version,
    prompt_variables: promptVariables && Object.keys(promptVariables).length > 0 ? promptVariables : undefined,
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

export const VoiceSessionBridge = ({ details, onReset }: VoiceSessionBridgeProps) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<VoiceSessionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

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

  const { connect, disconnect } = useRealtimeSession({
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
      onReset();
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

      setStatus("connecting");
      setError(null);

      try {
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
  }, [connect, disconnect, t, voiceSecret]);

  const handleStop = useCallback(() => {
    disconnect();
    onReset();
  }, [disconnect, onReset]);

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

