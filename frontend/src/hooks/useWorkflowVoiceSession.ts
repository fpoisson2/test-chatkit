import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeItem } from "@openai/agents/realtime";

import { useRealtimeSession } from "../voice/useRealtimeSession";
import {
  buildTranscriptsFromHistory,
  resolveApiKey,
  type VoiceSessionStatus,
  type VoiceTranscript,
} from "../voice/useVoiceSession";
import type { VoiceSessionSecret } from "../voice/useVoiceSecret";

type MicrophonePermissionState = "unknown" | "granted" | "denied";

type WorkflowLogEntry = {
  name: string;
  data?: Record<string, unknown> | null;
};

type WorkflowTaskLog = {
  content?: unknown;
  metadata?: Record<string, unknown> | null;
};

type WorkflowStepInfo = {
  slug?: unknown;
  title?: unknown;
} | null;

type WorkflowVoiceSessionRealtimeConfig = {
  start_mode?: unknown;
  stop_mode?: unknown;
  tools?: Record<string, unknown> | null;
};

type WorkflowVoiceSessionAudioConfig = {
  output?: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
};

type WorkflowVoiceSessionPayloadSession = {
  model?: unknown;
  voice?: unknown;
  instructions?: unknown;
  realtime?: WorkflowVoiceSessionRealtimeConfig | null;
  audio?: WorkflowVoiceSessionAudioConfig | null;
  prompt_id?: unknown;
  prompt_version?: unknown;
  prompt_variables?: Record<string, unknown> | null;
  [key: string]: unknown;
} | null;

type WorkflowVoiceSecretPayload = {
  value?: unknown;
  client_secret?: unknown;
  expires_at?: unknown;
  instructions?: unknown;
  model?: unknown;
  voice?: unknown;
  prompt_id?: unknown;
  prompt_version?: unknown;
  prompt_variables?: Record<string, unknown> | null;
  session?: WorkflowVoiceSessionPayloadSession;
} & Record<string, unknown>;

type VoiceSessionCreatedPayload = {
  type: string;
  client_secret?: WorkflowVoiceSecretPayload | string | null;
  session?: WorkflowVoiceSessionPayloadSession;
  step?: WorkflowStepInfo;
  tool_permissions?: Record<string, unknown> | null;
};

type ActiveVoiceSession = {
  slug: string | null;
  title: string | null;
  toolPermissions: Record<string, boolean> | null;
  secret: VoiceSessionSecret;
  sessionConfig: Record<string, unknown> | null;
};

type StopSessionOptions = {
  preserveTranscripts?: boolean;
};

export type UseWorkflowVoiceSessionResult = {
  status: VoiceSessionStatus;
  isListening: boolean;
  transcripts: VoiceTranscript[];
  webrtcError: string | null;
  localError: string | null;
  error: string | null;
  microphoneState: MicrophonePermissionState;
  isRequestingMic: boolean;
  activeStepSlug: string | null;
  activeStepTitle: string | null;
  toolPermissions: Record<string, boolean> | null;
  handleLogEvent: (entry: WorkflowLogEntry) => Promise<void>;
  stopSession: (options?: StopSessionOptions) => void;
};

const STOP_EVENT_NAMES = new Set([
  "workflow.run.completed",
  "workflow.run.failed",
  "workflow.run.cancelled",
  "workflow.run.canceled",
  "workflow.run.stopped",
  "workflow.wait_state.completed",
  "workflow.wait_state.cleared",
  "workflow.wait_state.cancelled",
  "workflow.wait_state.canceled",
  "workflow.wait_state.stopped",
  "workflow.step.completed",
  "workflow.step.failed",
  "workflow.step.cancelled",
  "workflow.step.canceled",
  "workflow.step.stopped",
]);

const DEFAULT_VOICE_INSTRUCTIONS = "Assistant vocal ChatKit";
const DEFAULT_VOICE_NAME = "alloy";

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    return "Une erreur inconnue est survenue.";
  }
};

const extractSlugFromMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  return asNonEmptyString(record.step_slug);
};

const extractTitleFromMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  return asNonEmptyString(record.step_title);
};

const extractStepSlug = (step: WorkflowStepInfo): string | null => {
  if (!step || typeof step !== "object") {
    return null;
  }
  return asNonEmptyString(step.slug);
};

const extractStepTitle = (step: WorkflowStepInfo): string | null => {
  if (!step || typeof step !== "object") {
    return null;
  }
  return asNonEmptyString(step.title);
};

const normalizeToolPermissions = (
  value: Record<string, unknown> | null | undefined,
): Record<string, boolean> | null => {
  if (!value) {
    return null;
  }
  const result: Record<string, boolean> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (typeof raw === "boolean") {
      result[key] = raw;
    }
  });
  return Object.keys(result).length > 0 ? result : null;
};

const normalizePromptVariables = (
  value: Record<string, unknown> | null | undefined,
): Record<string, string> | null => {
  if (!value) {
    return null;
  }
  const result: Record<string, string> = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (typeof raw === "string") {
      const trimmedKey = key.trim();
      if (trimmedKey) {
        result[trimmedKey] = raw;
      }
    }
  });
  return Object.keys(result).length > 0 ? result : null;
};

const normalizeExpiresAt = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    try {
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }
  return null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? (value as Record<string, unknown>) : null;

const extractVoiceFromSession = (session: Record<string, unknown> | null): string | null => {
  if (!session) {
    return null;
  }
  const audioValue = session["audio"];
  const audio = toRecord(audioValue);
  if (!audio) {
    return null;
  }
  const output = toRecord(audio["output"]);
  if (!output) {
    return null;
  }
  return asNonEmptyString(output["voice"]);
};

const extractClientSecretValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    return asNonEmptyString(value);
  }
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const direct = asNonEmptyString(record["client_secret"]);
  if (direct) {
    return direct;
  }
  const nested = toRecord(record["client_secret"]);
  if (nested) {
    const nestedValue = asNonEmptyString(nested["value"]);
    if (nestedValue) {
      return nestedValue;
    }
  }
  const valueField = asNonEmptyString(record["value"]);
  if (valueField) {
    return valueField;
  }
  return null;
};

const sanitizeSessionConfig = (
  primary: WorkflowVoiceSessionPayloadSession,
  fallback: unknown,
): Record<string, unknown> | null => {
  const candidate = toRecord(primary) ?? toRecord(fallback);
  if (!candidate) {
    return null;
  }
  return { ...candidate };
};

const buildVoiceSecretFromPayload = (
  payload: VoiceSessionCreatedPayload,
): { secret: VoiceSessionSecret; sessionConfig: Record<string, unknown> | null } | null => {
  const rawSecret = payload.client_secret;
  if (!rawSecret) {
    return null;
  }

  let secretRecord: Record<string, unknown> | null = null;
  if (typeof rawSecret === "string") {
    secretRecord = null;
  } else {
    secretRecord = toRecord(rawSecret);
  }

  const clientSecretValue =
    typeof rawSecret === "string"
      ? asNonEmptyString(rawSecret)
      : extractClientSecretValue(secretRecord ?? rawSecret);

  if (!clientSecretValue) {
    return null;
  }

  const secretSession = secretRecord ? toRecord(secretRecord["session"]) : null;
  const payloadSession = toRecord(payload.session ?? null);
  const sessionConfig = sanitizeSessionConfig(payload.session ?? null, secretSession);

  const instructions =
    asNonEmptyString(payloadSession?.["instructions"]) ??
    asNonEmptyString(secretSession?.["instructions"]) ??
    asNonEmptyString(secretRecord?.["instructions"]) ??
    DEFAULT_VOICE_INSTRUCTIONS;

  const model =
    asNonEmptyString(payloadSession?.["model"]) ??
    asNonEmptyString(secretSession?.["model"]) ??
    asNonEmptyString(secretRecord?.["model"]);

  if (!model) {
    return null;
  }

  const voice =
    asNonEmptyString(payloadSession?.["voice"]) ??
    extractVoiceFromSession(payloadSession) ??
    asNonEmptyString(secretSession?.["voice"]) ??
    extractVoiceFromSession(secretSession) ??
    asNonEmptyString(secretRecord?.["voice"]) ??
    DEFAULT_VOICE_NAME;

  const promptId =
    asNonEmptyString(secretRecord?.["prompt_id"]) ??
    asNonEmptyString(payloadSession?.["prompt_id"]) ??
    asNonEmptyString(secretSession?.["prompt_id"]);

  const promptVersion =
    asNonEmptyString(secretRecord?.["prompt_version"]) ??
    asNonEmptyString(payloadSession?.["prompt_version"]) ??
    asNonEmptyString(secretSession?.["prompt_version"]);

  const promptVariables =
    normalizePromptVariables(secretRecord?.["prompt_variables"] as Record<string, unknown> | undefined) ??
    normalizePromptVariables(payloadSession?.["prompt_variables"] as Record<string, unknown> | undefined) ??
    normalizePromptVariables(secretSession?.["prompt_variables"] as Record<string, unknown> | undefined);

  const expiresAt =
    normalizeExpiresAt(secretRecord?.["expires_at"]) ?? normalizeExpiresAt(secretSession?.["expires_at"]);

  const secret: VoiceSessionSecret = {
    client_secret: { value: clientSecretValue },
    instructions,
    model,
    voice,
  };

  if (typeof expiresAt === "string") {
    secret.expires_at = expiresAt;
  }
  if (promptId) {
    secret.prompt_id = promptId;
  }
  if (promptVersion) {
    secret.prompt_version = promptVersion;
  }
  if (promptVariables) {
    secret.prompt_variables = promptVariables;
  }

  return { secret, sessionConfig };
};

const extractRealtimeTools = (session: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!session) {
    return null;
  }
  const realtime = toRecord(session["realtime"]);
  if (!realtime) {
    return null;
  }
  const tools = toRecord(realtime["tools"]);
  return tools ?? null;
};

const extractToolPermissionsFromPayload = (
  payload: VoiceSessionCreatedPayload,
): Record<string, boolean> | null => {
  const direct = normalizeToolPermissions(payload.tool_permissions);
  if (direct) {
    return direct;
  }

  const payloadSession = toRecord(payload.session ?? null);
  const secretRecord = toRecord(payload.client_secret ?? null);
  const secretSession = secretRecord ? toRecord(secretRecord["session"]) : null;

  return (
    normalizeToolPermissions(extractRealtimeTools(payloadSession ?? null)) ??
    normalizeToolPermissions(extractRealtimeTools(secretSession))
  );
};

const extractSlugFromLogData = (
  data: Record<string, unknown> | null | undefined,
): string | null => {
  if (!data) {
    return null;
  }
  const slug = asNonEmptyString(data.slug);
  if (slug) {
    return slug;
  }

  const step = data.step;
  if (step && typeof step === "object") {
    const stepSlug = asNonEmptyString((step as Record<string, unknown>).slug);
    if (stepSlug) {
      return stepSlug;
    }
  }

  const task = data.task;
  if (task && typeof task === "object") {
    return extractSlugFromMetadata((task as WorkflowTaskLog).metadata ?? null);
  }

  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const parseVoiceSessionPayload = (value: unknown): VoiceSessionCreatedPayload | null => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseVoiceSessionPayload(parsed);
    } catch {
      return null;
    }
  }

  if (!isRecord(value)) {
    return null;
  }

  const payload = value as VoiceSessionCreatedPayload;
  const typeValue = asNonEmptyString(payload.type);
  if (!typeValue || !typeValue.startsWith("voice_session.")) {
    return null;
  }

  return payload;
};

const tryParseVoiceSessionTask = (
  task: unknown,
  metadataFallback: unknown,
): {
  payload: VoiceSessionCreatedPayload;
  metadataSlug: string | null;
  metadataTitle: string | null;
} | null => {
  if (!task || typeof task !== "object") {
    return null;
  }

  const taskLog = task as WorkflowTaskLog;
  const metadataSource =
    taskLog.metadata ?? (isRecord(metadataFallback) ? metadataFallback : null);

  const metadataSlug = extractSlugFromMetadata(metadataSource ?? null);
  const metadataTitle = extractTitleFromMetadata(metadataSource ?? null);

  const { content } = taskLog;
  const payload = parseVoiceSessionPayload(content ?? null);
  if (!payload) {
    return null;
  }

  return {
    payload,
    metadataSlug,
    metadataTitle,
  };
};

const extractVoiceTaskFromLogData = (
  data: unknown,
): {
  payload: VoiceSessionCreatedPayload;
  metadataSlug: string | null;
  metadataTitle: string | null;
} | null => {
  const directPayload = parseVoiceSessionPayload(data);
  if (directPayload) {
    return {
      payload: directPayload,
      metadataSlug: extractStepSlug(directPayload.step ?? null),
      metadataTitle: extractStepTitle(directPayload.step ?? null),
    };
  }

  if (!isRecord(data)) {
    return null;
  }

  const candidates: Array<{ task: unknown; metadata: unknown }> = [];

  if ("task" in data) {
    const candidate = (data as Record<string, unknown>).task;
    candidates.push({
      task: candidate,
      metadata:
        (isRecord(candidate) ? (candidate as WorkflowTaskLog).metadata : null) ??
        (data as Record<string, unknown>).metadata ??
        null,
    });
  }

  const maybeTaskItem = (data as Record<string, unknown>).task_item;
  if (isRecord(maybeTaskItem) && "task" in maybeTaskItem) {
    candidates.push({
      task: maybeTaskItem.task,
      metadata: maybeTaskItem.metadata ?? (data as Record<string, unknown>).metadata ?? null,
    });
  }

  const maybeItem = (data as Record<string, unknown>).item;
  if (isRecord(maybeItem)) {
    if ("task" in maybeItem) {
      candidates.push({
        task: maybeItem.task,
        metadata: maybeItem.metadata ?? (data as Record<string, unknown>).metadata ?? null,
      });
    }

    const nestedTaskItem = maybeItem.task_item;
    if (isRecord(nestedTaskItem) && "task" in nestedTaskItem) {
      candidates.push({
        task: nestedTaskItem.task,
        metadata: nestedTaskItem.metadata ?? maybeItem.metadata ?? null,
      });
    }
  }

  for (const candidate of candidates) {
    const parsed = tryParseVoiceSessionTask(candidate.task, candidate.metadata);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const requestMicrophoneAccess = async (): Promise<{
  ok: boolean;
  state: MicrophonePermissionState;
  message?: string;
}> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      state: "denied",
      message: "Accès au microphone non supporté sur ce navigateur.",
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignorer les erreurs d'arrêt de piste.
      }
    });
    return { ok: true, state: "granted" };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      return {
        ok: false,
        state: "denied",
        message: "Permission microphone refusée.",
      };
    }
    return {
      ok: false,
      state: "denied",
      message: formatErrorMessage(error),
    };
  }
};

export const useWorkflowVoiceSession = (): UseWorkflowVoiceSessionResult => {
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [microphoneState, setMicrophoneState] = useState<MicrophonePermissionState>("unknown");
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [activeStepSlug, setActiveStepSlug] = useState<string | null>(null);
  const [activeStepTitle, setActiveStepTitle] = useState<string | null>(null);
  const [toolPermissions, setToolPermissions] = useState<Record<string, boolean> | null>(null);

  const activeSessionRef = useRef<ActiveVoiceSession | null>(null);
  const activeSecretRef = useRef<VoiceSessionSecret | null>(null);
  const startAttemptRef = useRef(0);
  const suppressEmptyHistoryRef = useRef(false);

  const handleHistoryUpdated = useCallback(
    (history: RealtimeItem[]) => {
      if (history.length === 0 && suppressEmptyHistoryRef.current) {
        return;
      }
      suppressEmptyHistoryRef.current = false;
      setTranscripts((previous) => buildTranscriptsFromHistory(history, previous));
    },
    [],
  );

  const handleConnectionChange = useCallback((value: "connected" | "connecting" | "disconnected") => {
    if (value === "connected") {
      setStatus("connected");
      setIsListening(true);
    } else if (value === "connecting") {
      setStatus("connecting");
    } else {
      setIsListening(false);
      if (activeSessionRef.current === null) {
        setStatus("idle");
      }
    }
  }, []);

  const handleAgentStart = useCallback(() => {
    setIsListening(true);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setIsListening(false);
  }, []);

  const handleTransportError = useCallback((error: unknown) => {
    const message = formatErrorMessage(error);
    setWebrtcError(message);
    setLocalError(message);
    setStatus("error");
  }, []);

  const handleSessionError = useCallback((error: unknown) => {
    const message = formatErrorMessage(error);
    setLocalError(message);
    setStatus((current) => (current === "idle" ? "error" : current));
  }, []);

  const { connect, disconnect } = useRealtimeSession({
    onHistoryUpdated: handleHistoryUpdated,
    onConnectionChange: handleConnectionChange,
    onAgentStart: handleAgentStart,
    onAgentEnd: handleAgentEnd,
    onTransportError: handleTransportError,
    onError: handleSessionError,
    onRefreshDue: () => {
      const activeSession = activeSessionRef.current;
      const secret = activeSecretRef.current;
      if (!secret || !activeSession) {
        return;
      }
      const apiKey = resolveApiKey(secret.client_secret);
      if (!apiKey) {
        return;
      }
      void connect({ secret, apiKey, sessionConfig: activeSession.sessionConfig }).catch((error) => {
        const message = formatErrorMessage(error);
        setWebrtcError(message);
        setLocalError(message);
        setStatus("error");
      });
    },
  });

  const stopSession = useCallback(
    ({ preserveTranscripts = true }: StopSessionOptions = {}) => {
      startAttemptRef.current += 1;
      disconnect();
      activeSecretRef.current = null;
      activeSessionRef.current = null;
      setIsListening(false);
      setStatus("idle");
      setIsRequestingMic(false);
      setActiveStepSlug(null);
      setActiveStepTitle(null);
      setToolPermissions(null);
      suppressEmptyHistoryRef.current = false;
      if (!preserveTranscripts) {
        setTranscripts([]);
      }
    },
    [disconnect],
  );

  const startFromPayload = useCallback(
    async (
      payload: VoiceSessionCreatedPayload,
      {
        metadataSlug,
        metadataTitle,
      }: { metadataSlug: string | null; metadataTitle: string | null },
    ) => {
      stopSession({ preserveTranscripts: false });

      if (!payload.client_secret) {
        setLocalError("Secret vocal manquant dans l'évènement du workflow.");
        setStatus("error");
        return;
      }

      const normalized = buildVoiceSecretFromPayload(payload);
      if (!normalized) {
        setLocalError("Secret temps réel invalide reçu pour la session vocale du workflow.");
        setStatus("error");
        return;
      }

      const { secret, sessionConfig } = normalized;

      const apiKey = resolveApiKey(secret.client_secret);
      if (!apiKey) {
        setLocalError("Secret temps réel invalide reçu pour la session vocale du workflow.");
        setStatus("error");
        return;
      }

      const attemptId = startAttemptRef.current + 1;
      startAttemptRef.current = attemptId;

      activeSecretRef.current = secret;

      const slug = metadataSlug ?? extractStepSlug(payload.step ?? null);
      const title = metadataTitle ?? extractStepTitle(payload.step ?? null);
      const normalizedTools = extractToolPermissionsFromPayload(payload);

      activeSessionRef.current = {
        slug,
        title,
        toolPermissions: normalizedTools,
        secret,
        sessionConfig,
      };

      setActiveStepSlug(slug);
      setActiveStepTitle(title);
      setToolPermissions(normalizedTools);
      setLocalError(null);
      setWebrtcError(null);
      setTranscripts([]);
      suppressEmptyHistoryRef.current = true;

      setStatus("connecting");
      setIsListening(false);
      setIsRequestingMic(true);

      const microphoneResult = await requestMicrophoneAccess();
      if (startAttemptRef.current !== attemptId) {
        return;
      }

      setIsRequestingMic(false);
      setMicrophoneState(microphoneResult.state);

      if (!microphoneResult.ok) {
        setLocalError(microphoneResult.message ?? "Impossible d'activer le microphone.");
        setStatus("error");
        return;
      }

      try {
        await connect({ secret, apiKey, sessionConfig });
        if (startAttemptRef.current !== attemptId) {
          return;
        }
        setStatus("connected");
        setIsListening(true);
      } catch (error) {
        if (startAttemptRef.current !== attemptId) {
          return;
        }
        const message = formatErrorMessage(error);
        setLocalError(message);
        setWebrtcError(message);
        setStatus("error");
        setIsListening(false);
      }
    },
    [connect, stopSession],
  );

  useEffect(
    () => () => {
      stopSession();
    },
    [stopSession],
  );

  const handleLogEvent = useCallback(
    async ({ name, data }: WorkflowLogEntry) => {
      if (!name) {
        return;
      }

      const voiceTask = extractVoiceTaskFromLogData(data ?? null);
      if (voiceTask) {
        const { payload, metadataSlug, metadataTitle } = voiceTask;
        const typeValue = asNonEmptyString(payload.type);
        if (typeValue === "voice_session.created") {
          await startFromPayload(payload, { metadataSlug, metadataTitle });
          return;
        }

        if (typeValue && typeValue.startsWith("voice_session.")) {
          stopSession();
          return;
        }
      }

      if (activeSessionRef.current) {
        if (STOP_EVENT_NAMES.has(name)) {
          const slugFromEvent = extractSlugFromLogData(data ?? undefined);
          const activeSlug = activeSessionRef.current.slug;
          if (!slugFromEvent || !activeSlug || slugFromEvent === activeSlug) {
            stopSession();
          }
        }
      }
    },
    [startFromPayload, stopSession],
  );

  const error = useMemo(() => localError ?? webrtcError, [localError, webrtcError]);

  return useMemo(
    () => ({
      status,
      isListening,
      transcripts,
      webrtcError,
      localError,
      error,
      microphoneState,
      isRequestingMic,
      activeStepSlug,
      activeStepTitle,
      toolPermissions,
      handleLogEvent,
      stopSession,
    }),
    [
      status,
      isListening,
      transcripts,
      webrtcError,
      localError,
      error,
      microphoneState,
      isRequestingMic,
      activeStepSlug,
      activeStepTitle,
      toolPermissions,
      handleLogEvent,
      stopSession,
    ],
  );
};

export type { MicrophonePermissionState };
