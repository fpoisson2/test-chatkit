import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { chatkitApi } from "../utils/backend";
import type { VoiceSessionSecret } from "./useVoiceSecret";
import {
  useVoiceSessionController,
  type UseVoiceSessionControllerResult,
  type VoiceSessionStatus,
  type VoiceTranscript,
} from "./useVoiceSessionController";

export type WorkflowVoiceRealtimeConfig = {
  startMode: "manual" | "auto";
  stopMode: "manual" | "auto";
  toolPermissions: Record<string, boolean>;
};

export type WorkflowVoiceSessionInfo = {
  threadId: string;
  taskId: string | null;
  stepSlug: string;
  stepTitle: string | null;
  model: string;
  voice: string;
  instructions: string;
  realtime: WorkflowVoiceRealtimeConfig;
};

type ActiveVoiceSession = WorkflowVoiceSessionInfo & {
  secret: VoiceSessionSecret;
};

type WorkflowVoiceActivationPayload = {
  threadId: string | null | undefined;
  taskId: string | null;
  stepSlug: string | null | undefined;
  stepTitle?: string | null;
  secret: VoiceSessionSecret | null | undefined;
  model: string | null | undefined;
  voice: string | null | undefined;
  instructions: string | null | undefined;
  realtime: WorkflowVoiceRealtimeConfig | null | undefined;
};

type SubmitVoiceTranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  status?: string | null;
};

type UseWorkflowVoiceAgentOptions = {
  token: string | null;
  onTranscriptsSubmitted?: () => Promise<void> | void;
};

type UseWorkflowVoiceAgentResult = {
  sessionInfo: WorkflowVoiceSessionInfo | null;
  status: VoiceSessionStatus;
  isListening: boolean;
  transcripts: VoiceTranscript[];
  finalTranscripts: VoiceTranscript[];
  errors: UseVoiceSessionControllerResult["errors"];
  webrtcError: string | null;
  activate: (payload: WorkflowVoiceActivationPayload) => void;
  deactivate: () => void;
  start: () => Promise<void>;
  stop: () => void;
  clearErrors: () => void;
  submitTranscripts: () => Promise<void>;
  isSubmitting: boolean;
  submissionError: string | null;
};

const sanitizeRealtimeConfig = (
  config: WorkflowVoiceRealtimeConfig | null | undefined,
): WorkflowVoiceRealtimeConfig => {
  if (!config) {
    return { startMode: "manual", stopMode: "auto", toolPermissions: {} };
  }
  const startMode = config.startMode === "auto" ? "auto" : "manual";
  const stopMode = config.stopMode === "manual" ? "manual" : "auto";
  const toolPermissions: Record<string, boolean> = {};
  Object.entries(config.toolPermissions ?? {}).forEach(([key, value]) => {
    toolPermissions[key] = Boolean(value);
  });
  return { startMode, stopMode, toolPermissions };
};

const normalizeText = (value: string | null | undefined): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const filterCompletedTranscripts = (entries: VoiceTranscript[]): VoiceTranscript[] =>
  entries.filter((entry) => entry.text.trim() && entry.status !== "in_progress");

export const useWorkflowVoiceAgent = ({
  token,
  onTranscriptsSubmitted,
}: UseWorkflowVoiceAgentOptions): UseWorkflowVoiceAgentResult => {
  const voiceController = useVoiceSessionController();
  const { status, isListening, transcripts, errors, webrtcError, startSession, stopSession, clearErrors } =
    voiceController;

  const [activeSession, setActiveSession] = useState<ActiveVoiceSession | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const processedTaskRef = useRef<string | null>(null);
  const submittedRef = useRef(false);

  const sessionInfo = useMemo<WorkflowVoiceSessionInfo | null>(() => {
    if (!activeSession) {
      return null;
    }
    const { secret: _secret, ...publicInfo } = activeSession;
    return publicInfo;
  }, [activeSession]);

  const finalTranscripts = useMemo(() => filterCompletedTranscripts(transcripts), [transcripts]);

  const deactivate = useCallback(() => {
    processedTaskRef.current = null;
    submittedRef.current = false;
    setActiveSession(null);
    setSubmissionError(null);
    stopSession({ clearHistory: true, nextStatus: "idle" });
  }, [stopSession]);

  const activate = useCallback(
    (payload: WorkflowVoiceActivationPayload) => {
      const threadId = normalizeText(payload.threadId ?? null);
      const stepSlug = normalizeText(payload.stepSlug ?? null);
      const secret = payload.secret ?? null;
      if (!threadId || !stepSlug || !secret) {
        return;
      }

      const model = normalizeText(payload.model);
      const voice = normalizeText(payload.voice);
      const instructions = normalizeText(payload.instructions);
      const realtime = sanitizeRealtimeConfig(payload.realtime);
      const taskId = payload.taskId ?? null;

      if (
        processedTaskRef.current &&
        processedTaskRef.current === taskId &&
        activeSession &&
        activeSession.threadId === threadId &&
        activeSession.stepSlug === stepSlug
      ) {
        return;
      }

      processedTaskRef.current = taskId;
      submittedRef.current = false;
      setSubmissionError(null);
      setIsSubmitting(false);
      stopSession({ clearHistory: true, nextStatus: "idle" });
      setActiveSession({
        threadId,
        taskId,
        stepSlug,
        stepTitle: normalizeText(payload.stepTitle ?? null) || null,
        model,
        voice,
        instructions,
        realtime,
        secret,
      });
    },
    [activeSession, stopSession],
  );

  const start = useCallback(async () => {
    if (!activeSession) {
      throw new Error("Aucune session vocale active.");
    }
    await startSession({ preserveHistory: false, secretOverride: activeSession.secret });
  }, [activeSession, startSession]);

  const stop = useCallback(() => {
    stopSession({ clearHistory: false, nextStatus: "idle" });
  }, [stopSession]);

  const submitTranscripts = useCallback(async () => {
    if (!activeSession) {
      setSubmissionError("no_session");
      return;
    }
    if (submittedRef.current) {
      return;
    }
    const entries = filterCompletedTranscripts(transcripts)
      .map<SubmitVoiceTranscriptEntry>((entry) => ({
        role: entry.role,
        text: entry.text.trim(),
        status: entry.status,
      }))
      .filter((entry) => entry.text.length > 0);

    if (entries.length === 0) {
      setSubmissionError("no_transcripts");
      return;
    }
    if (!token) {
      setSubmissionError("auth_required");
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      await chatkitApi.submitVoiceTranscripts(token, {
        thread_id: activeSession.threadId,
        step_slug: activeSession.stepSlug,
        voice_transcripts: entries,
      });
      submittedRef.current = true;
      stopSession({ clearHistory: true, nextStatus: "idle" });
      setActiveSession(null);
      processedTaskRef.current = null;
      if (onTranscriptsSubmitted) {
        await onTranscriptsSubmitted();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected";
      setSubmissionError(message || "unexpected");
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSession, onTranscriptsSubmitted, stopSession, token, transcripts]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    if (submittedRef.current || isSubmitting) {
      return;
    }
    if (!finalTranscripts.length) {
      return;
    }
    if (!isListening && status !== "connecting") {
      void submitTranscripts();
    }
  }, [activeSession, finalTranscripts.length, isListening, isSubmitting, status, submitTranscripts]);

  return {
    sessionInfo,
    status,
    isListening,
    transcripts,
    finalTranscripts,
    errors,
    webrtcError,
    activate,
    deactivate,
    start,
    stop,
    clearErrors,
    submitTranscripts,
    isSubmitting,
    submissionError,
  };
};

export type { UseWorkflowVoiceAgentResult };
