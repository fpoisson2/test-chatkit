import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeItem } from "@openai/agents/realtime";

import { useRealtimeSession } from "../voice/useRealtimeSession";
import { useMicrophoneAccess } from "../voice/useMicrophoneAccess";
import {
  VOICE_SESSION_MAX_ERROR_LOG_ENTRIES,
  buildTranscriptsFromHistory,
  formatErrorMessage,
  makeErrorEntry,
  resolveApiKey,
  type VoiceSessionError,
  type VoiceSessionStatus,
  type VoiceTranscript,
} from "../voice/voiceSessionShared";
import type { MicrophonePermissionState } from "../voice/useMicrophoneAccess";
import type { VoiceSessionSecret } from "../voice/useVoiceSecret";

type WorkflowRealtimeConfig = {
  start_mode?: string;
  stop_mode?: string;
  tools?: Record<string, boolean>;
};

type WorkflowVoiceSessionConfig = {
  model?: string;
  voice?: string;
  instructions?: string;
  realtime?: WorkflowRealtimeConfig | null;
  tool_definitions?: unknown;
};

type WorkflowVoiceTaskPayload = {
  taskId?: string | null;
  client_secret: VoiceSessionSecret;
  session: WorkflowVoiceSessionConfig;
  tool_permissions?: Record<string, boolean> | null;
};

type WorkflowWaitStateTranscript = {
  role?: string;
  text?: string;
  status?: string;
};

type WorkflowVoiceMetadata = {
  waitState: unknown;
  state: unknown;
};

type UseWorkflowVoiceSessionOptions = {
  reportError?: (message: string, detail?: unknown) => void;
};

type UseWorkflowVoiceSessionResult = {
  status: VoiceSessionStatus;
  isListening: boolean;
  transcripts: VoiceTranscript[];
  errors: VoiceSessionError[];
  webrtcError: string | null;
  toolPermissions: Record<string, boolean>;
  microphone: {
    permission: MicrophonePermissionState;
    error: string | null;
    isRequesting: boolean;
    requestPermission: () => Promise<boolean>;
    resetError: () => void;
  };
  startFromTask: (payload: WorkflowVoiceTaskPayload) => Promise<void>;
  syncWorkflowMetadata: (metadata: WorkflowVoiceMetadata) => void;
  stopSession: () => void;
  clearErrors: () => void;
};

const normalizeMode = (value: unknown, fallback: "auto" | "manual" = "auto"): "auto" | "manual" => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "manual") {
      return normalized;
    }
  }
  return fallback;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeTranscriptStatus = (value: unknown): VoiceTranscript["status"] => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "in_progress" || normalized === "completed" || normalized === "incomplete") {
      return normalized;
    }
  }
  return "completed";
};

const buildSessionUpdateFromWorkflow = (
  session: WorkflowVoiceSessionConfig | null | undefined,
): Record<string, unknown> | null => {
  if (!session || !isPlainObject(session)) {
    return null;
  }
  const update: Record<string, unknown> = {};
  if (typeof session.model === "string" && session.model.trim()) {
    update.model = session.model.trim();
  }
  if (typeof session.voice === "string" && session.voice.trim()) {
    update.voice = session.voice.trim();
  }
  if (typeof session.instructions === "string" && session.instructions.trim()) {
    update.instructions = session.instructions;
  }
  if (session.realtime && isPlainObject(session.realtime)) {
    update.realtime = session.realtime;
  }
  if ("tool_definitions" in session) {
    update.tools = session.tool_definitions;
  }
  return Object.keys(update).length > 0 ? update : null;
};

const buildTranscriptsFromWaitState = (
  entries: WorkflowWaitStateTranscript[],
  previous: VoiceTranscript[],
): VoiceTranscript[] => {
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  const result: VoiceTranscript[] = [];

  entries.forEach((entry, index) => {
    const roleRaw = entry.role;
    if (typeof roleRaw !== "string") {
      return;
    }
    const normalizedRole = roleRaw.trim().toLowerCase();
    if (normalizedRole !== "user" && normalizedRole !== "assistant") {
      return;
    }
    const textRaw = entry.text;
    if (typeof textRaw !== "string") {
      return;
    }
    const text = textRaw.trim();
    if (!text) {
      return;
    }
    const status = normalizeTranscriptStatus(entry.status);
    const id = `${normalizedRole}:${text}:${status}:${index}`;
    const existing = previousMap.get(id);
    result.push({
      id,
      role: normalizedRole as "user" | "assistant",
      text,
      status,
      timestamp: existing?.timestamp ?? Date.now() + index,
    });
  });

  return result;
};

export const useWorkflowVoiceSession = ({
  reportError,
}: UseWorkflowVoiceSessionOptions = {}): UseWorkflowVoiceSessionResult => {
  const reportErrorRef = useRef(reportError);
  useEffect(() => {
    reportErrorRef.current = reportError;
  }, [reportError]);

  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [errors, setErrors] = useState<VoiceSessionError[]>([]);
  const [webrtcError, setWebrtcError] = useState<string | null>(null);
  const [toolPermissions, setToolPermissions] = useState<Record<string, boolean>>({});

  const suppressEmptyHistoryRef = useRef(false);
  const waitStateSignatureRef = useRef<string | null>(null);
  const activeSessionRef = useRef<{ secret: VoiceSessionSecret; session: WorkflowVoiceSessionConfig } | null>(null);
  const lastTaskIdRef = useRef<string | null>(null);
  const startModeRef = useRef<"auto" | "manual">("auto");
  const stopModeRef = useRef<"auto" | "manual">("auto");

  const {
    permission: microphonePermission,
    error: microphoneError,
    isRequesting: isRequestingMic,
    requestPermission,
    resetError: resetMicrophoneError,
  } = useMicrophoneAccess();
  const microphoneErrorRef = useRef<string | null>(null);
  useEffect(() => {
    microphoneErrorRef.current = microphoneError;
  }, [microphoneError]);

  const addError = useCallback((message: string) => {
    setErrors((prev) => {
      const next = [...prev, makeErrorEntry(message)];
      return next.slice(-VOICE_SESSION_MAX_ERROR_LOG_ENTRIES);
    });
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setWebrtcError(null);
  }, []);

  const updateTranscriptsFromHistory = useCallback((history: RealtimeItem[]) => {
    setTranscripts((prev) => buildTranscriptsFromHistory(history, prev));
  }, []);

  const handleHistoryUpdated = useCallback(
    (history: RealtimeItem[]) => {
      if (history.length === 0 && suppressEmptyHistoryRef.current) {
        return;
      }
      suppressEmptyHistoryRef.current = false;
      updateTranscriptsFromHistory(history);
    },
    [updateTranscriptsFromHistory],
  );

  const handleConnectionChange = useCallback((value: "connected" | "connecting" | "disconnected") => {
    if (value === "connected") {
      setStatus("connected");
      setIsListening(true);
    } else if (value === "connecting") {
      setStatus("connecting");
    } else {
      setIsListening(false);
      setStatus("idle");
    }
  }, []);

  const handleAgentStart = useCallback(() => {
    setIsListening(true);
  }, []);

  const handleAgentEnd = useCallback(() => {
    setIsListening(false);
  }, []);

  const handleTransportError = useCallback(
    (error: unknown) => {
      const message = formatErrorMessage(error);
      addError(message);
      setWebrtcError(message);
    },
    [addError],
  );

  const handleSessionError = useCallback(
    (error: unknown) => {
      const message = formatErrorMessage(error);
      addError(message);
    },
    [addError],
  );

  const reconnectWithCurrentSecret = useCallback(() => {
    const active = activeSessionRef.current;
    if (!active) {
      return;
    }
    const apiKey = resolveApiKey(active.secret.client_secret);
    if (!apiKey) {
      const message = "Secret temps réel invalide renvoyé par le workflow.";
      addError(message);
      setWebrtcError(message);
      setStatus("error");
      reportErrorRef.current?.(message);
      return;
    }
    suppressEmptyHistoryRef.current = true;
    setStatus("connecting");
    void connect({ secret: active.secret, apiKey, sessionUpdate: buildSessionUpdateFromWorkflow(active.session) }).catch(
      (error) => {
        const message = formatErrorMessage(error);
        addError(message);
        setWebrtcError(message);
        setStatus("error");
        reportErrorRef.current?.(message, error);
      },
    );
  }, [addError, connect]);

  const { connect, disconnect } = useRealtimeSession({
    onHistoryUpdated: handleHistoryUpdated,
    onConnectionChange: handleConnectionChange,
    onAgentStart: handleAgentStart,
    onAgentEnd: handleAgentEnd,
    onTransportError: handleTransportError,
    onError: handleSessionError,
    onRefreshDue: reconnectWithCurrentSecret,
  });

  const stopSession = useCallback(() => {
    disconnect();
    setIsListening(false);
    setStatus("idle");
    suppressEmptyHistoryRef.current = false;
    waitStateSignatureRef.current = null;
    activeSessionRef.current = null;
    setToolPermissions({});
    startModeRef.current = "auto";
    stopModeRef.current = "auto";
  }, [disconnect]);

  useEffect(() => () => {
    stopSession();
  }, [stopSession]);

  const startFromTask = useCallback(
    async ({ taskId, client_secret: secret, session, tool_permissions }: WorkflowVoiceTaskPayload) => {
      if (taskId && lastTaskIdRef.current === taskId) {
        return;
      }
      lastTaskIdRef.current = taskId ?? null;

      activeSessionRef.current = { secret, session };
      waitStateSignatureRef.current = null;
      setToolPermissions(tool_permissions ?? {});
      setTranscripts([]);
      clearErrors();
      resetMicrophoneError();

      const startMode = normalizeMode(session?.realtime?.start_mode);
      const stopMode = normalizeMode(session?.realtime?.stop_mode);
      startModeRef.current = startMode;
      stopModeRef.current = stopMode;

      const apiKey = resolveApiKey(secret.client_secret);
      if (!apiKey) {
        const message = "Secret temps réel invalide renvoyé par le workflow.";
        addError(message);
        setWebrtcError(message);
        setStatus("error");
        reportErrorRef.current?.(message);
        activeSessionRef.current = null;
        return;
      }

      if (startMode === "auto") {
        const granted = await requestPermission();
        if (!granted) {
          const message = microphoneErrorRef.current ?? "Impossible d'activer le microphone.";
          addError(message);
          setStatus("error");
          reportErrorRef.current?.(message);
          activeSessionRef.current = null;
          return;
        }
      }

      disconnect();
      suppressEmptyHistoryRef.current = false;
      setIsListening(false);
      setStatus("connecting");
      setWebrtcError(null);

      try {
        await connect({
          secret,
          apiKey,
          sessionUpdate: buildSessionUpdateFromWorkflow(session),
        });
        setStatus("connected");
        setIsListening(true);
      } catch (error) {
        disconnect();
        setIsListening(false);
        setStatus("error");
        const message = formatErrorMessage(error);
        addError(message);
        setWebrtcError(message);
        reportErrorRef.current?.(message, error);
        activeSessionRef.current = null;
      }
    },
    [addError, clearErrors, connect, disconnect, requestPermission, resetMicrophoneError],
  );

  const syncWorkflowMetadata = useCallback(
    ({ waitState, state }: WorkflowVoiceMetadata) => {
      const waitStateObject = isPlainObject(waitState) ? (waitState as Record<string, unknown>) : null;
      const stateObject = isPlainObject(state) ? (state as Record<string, unknown>) : null;

      const transcriptsPayload = Array.isArray(waitStateObject?.voice_transcripts)
        ? (waitStateObject?.voice_transcripts as WorkflowWaitStateTranscript[])
        : null;

      if (transcriptsPayload && transcriptsPayload.length > 0) {
        const signature = JSON.stringify(transcriptsPayload);
        if (waitStateSignatureRef.current !== signature) {
          waitStateSignatureRef.current = signature;
          setTranscripts((prev) => buildTranscriptsFromWaitState(transcriptsPayload, prev));
          if (stopModeRef.current === "auto") {
            stopSession();
          } else {
            setIsListening(false);
          }
        }
        return;
      }

      waitStateSignatureRef.current = null;

      const voiceSessionActive = Boolean(
        stateObject && typeof stateObject.voice_session_active === "boolean"
          ? stateObject.voice_session_active
          : false,
      );

      if (!voiceSessionActive && activeSessionRef.current) {
        stopSession();
      }
    },
    [stopSession],
  );

  const microphone = useMemo(
    () => ({
      permission: microphonePermission,
      error: microphoneError,
      isRequesting: isRequestingMic,
      requestPermission,
      resetError: resetMicrophoneError,
    }),
    [isRequestingMic, microphoneError, microphonePermission, requestPermission, resetMicrophoneError],
  );

  return useMemo(
    () => ({
      status,
      isListening,
      transcripts,
      errors,
      webrtcError,
      toolPermissions,
      microphone,
      startFromTask,
      syncWorkflowMetadata,
      stopSession,
      clearErrors,
    }),
    [
      clearErrors,
      errors,
      isListening,
      microphone,
      startFromTask,
      status,
      stopSession,
      syncWorkflowMetadata,
      toolPermissions,
      transcripts,
      webrtcError,
    ],
  );
};

export type {
  WorkflowVoiceMetadata,
  WorkflowVoiceSessionConfig,
  WorkflowVoiceTaskPayload,
  UseWorkflowVoiceSessionOptions,
  UseWorkflowVoiceSessionResult,
};
