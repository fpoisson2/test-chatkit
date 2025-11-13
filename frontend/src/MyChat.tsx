import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatKitOptions, StartScreenPrompt } from "@openai/chatkit";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { ChatKitHost } from "./components/my-chat/ChatKitHost";
import { ChatSidebar, type WorkflowActivation } from "./components/my-chat/ChatSidebar";
import { OutboundCallAudioPlayer } from "./components/my-chat/OutboundCallAudioPlayer";
import {
  useAppearanceSettings,
  type AppearanceWorkflowReference,
} from "./features/appearance/AppearanceSettingsContext";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow, type HostedFlowMode } from "./hooks/useHostedFlow";
import { useWorkflowChatSession } from "./hooks/useWorkflowChatSession";
import { useWorkflowVoiceSession } from "./hooks/useWorkflowVoiceSession";
import { useOutboundCallSession } from "./hooks/useOutboundCallSession";
import { useChatApiConfig } from "./hooks/useChatApiConfig";
import { getOrCreateDeviceId } from "./utils/device";
import { clearStoredChatKitSecret } from "./utils/chatkitSession";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import type { WorkflowSummary } from "./types/workflows";
import type { AppearanceSettings } from "./utils/backend";

type WeatherToolCall = {
  name: "get_weather";
  params: {
    city: string;
    country?: string | null;
  };
};

type ClientToolCall = WeatherToolCall;

type ResetChatStateOptions = {
  selection?: WorkflowActivation | null;
  preserveStoredThread?: boolean;
  targetMode?: HostedFlowMode;
};

const HOSTED_STORAGE_PREFIX = "hosted::";
const DEFAULT_WORKFLOW_STORAGE_KEY = "__default__";
const FALLBACK_SELECTION: WorkflowActivation = { kind: "local", workflow: null };

const normalizeWorkflowStorageKey = (slug: string | null | undefined) => {
  const trimmed = slug?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKFLOW_STORAGE_KEY;
};

const resolvePersistenceSlug = (
  mode: HostedFlowMode,
  selection: WorkflowActivation | null | undefined,
): string | null => {
  const effectiveSelection = selection ?? FALLBACK_SELECTION;
  const baseSlug =
    effectiveSelection.kind === "hosted"
      ? effectiveSelection.slug
      : effectiveSelection.workflow?.slug ?? null;

  if (mode === "hosted") {
    return `${HOSTED_STORAGE_PREFIX}${normalizeWorkflowStorageKey(baseSlug)}`;
  }

  return baseSlug;
};

const buildSessionStorageKey = (owner: string, slug: string | null | undefined) =>
  `${owner}:${normalizeWorkflowStorageKey(slug)}`;

type ResolvedColorScheme = "light" | "dark";

const clampToRange = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const TERMINAL_THREAD_STATUSES = new Set([
  "completed",
  "cancelled",
  "failed",
  "expired",
  "archived",
]);

type ThreadStatus = string | null;

type ChatInstanceEntry = {
  selection: WorkflowActivation;
  mode: HostedFlowMode;
  chatInstanceKey: number;
  initialThreadId: string | null;
  threadStatus: ThreadStatus;
  hasActiveThread: boolean;
  persistenceSlug: string | null;
};

type ChatInstancesState = Record<string, ChatInstanceEntry>;

const computeHasActiveThread = (
  threadId: string | null,
  status: ThreadStatus,
) => threadId != null && !(status && TERMINAL_THREAD_STATUSES.has(status));

type AttachmentsConfig = NonNullable<
  NonNullable<ChatKitOptions["composer"]>["attachments"]
>;

const buildChatInstanceId = (
  mode: HostedFlowMode,
  selection: WorkflowActivation,
) =>
  normalizeWorkflowStorageKey(resolvePersistenceSlug(mode, selection));

const createChatInstanceEntry = ({
  selection,
  mode,
  persistenceSlug,
  initialThreadId,
  threadStatus = null,
  chatInstanceKey = 0,
}: {
  selection: WorkflowActivation;
  mode: HostedFlowMode;
  persistenceSlug: string | null;
  initialThreadId: string | null;
  threadStatus?: ThreadStatus;
  chatInstanceKey?: number;
}): ChatInstanceEntry => ({
  selection,
  mode,
  chatInstanceKey,
  initialThreadId,
  threadStatus,
  hasActiveThread: computeHasActiveThread(initialThreadId, threadStatus ?? null),
  persistenceSlug,
});

type SurfacePalette = {
  light: { background: string; foreground: string; border: string };
  dark: { background: string; foreground: string; border: string };
};

const DEFAULT_LIGHT_SURFACE = "#ffffff";
const DEFAULT_LIGHT_SURFACE_SUBTLE = "#f4f4f5";
const DEFAULT_LIGHT_BORDER = "rgba(24, 24, 27, 0.12)";
const DEFAULT_DARK_SURFACE = "#18181b";
const DEFAULT_DARK_SURFACE_SUBTLE = "#111114";
const DEFAULT_DARK_BORDER = "rgba(228, 228, 231, 0.16)";

const buildSurfacePalette = (settings: AppearanceSettings): SurfacePalette => {
  if (!settings.use_custom_surface_colors) {
    return {
      light: {
        background: DEFAULT_LIGHT_SURFACE,
        foreground: DEFAULT_LIGHT_SURFACE_SUBTLE,
        border: DEFAULT_LIGHT_BORDER,
      },
      dark: {
        background: DEFAULT_DARK_SURFACE,
        foreground: DEFAULT_DARK_SURFACE_SUBTLE,
        border: DEFAULT_DARK_BORDER,
      },
    };
  }

  const hue = clampToRange(settings.surface_hue ?? 222, 0, 360);
  const tint = clampToRange(settings.surface_tint ?? 92, 0, 100);
  const shade = clampToRange(settings.surface_shade ?? 16, 0, 100);

  const lightBackground = `hsl(${hue} 28% ${clampToRange(tint, 20, 98)}%)`;
  const lightForeground = `hsl(${hue} 32% ${clampToRange(tint + 4, 20, 100)}%)`;
  const lightBorder = `hsla(${hue} 30% ${clampToRange(tint - 38, 0, 90)}%, 0.28)`;
  const darkBackground = `hsl(${hue} 20% ${clampToRange(shade, 2, 42)}%)`;
  const darkForeground = `hsl(${hue} 18% ${clampToRange(shade - 6, 0, 32)}%)`;
  const darkBorder = `hsla(${hue} 34% ${clampToRange(shade + 30, 0, 100)}%, 0.28)`;

  return {
    light: {
      background: lightBackground,
      foreground: lightForeground,
      border: lightBorder,
    },
    dark: {
      background: darkBackground,
      foreground: darkForeground,
      border: darkBorder,
    },
  };
};

const resolveSurfaceColors = (
  palette: SurfacePalette,
  scheme: ResolvedColorScheme,
): SurfacePalette["light"] =>
  scheme === "dark" ? palette.dark : palette.light;

const resolveThemeColorScheme = (
  settings: AppearanceSettings,
  preferred: ResolvedColorScheme,
): ResolvedColorScheme => {
  if (settings.color_scheme === "light" || settings.color_scheme === "dark") {
    return settings.color_scheme;
  }
  return preferred;
};

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const parseStartScreenPrompts = (
  raw: string | null | undefined,
): StartScreenPrompt[] => {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry, index) => {
      const separatorIndex = entry.indexOf("|");

      let label = entry;
      let prompt = entry;

      if (separatorIndex !== -1) {
        const rawLabel = entry.slice(0, separatorIndex).trim();
        const rawPrompt = entry.slice(separatorIndex + 1).trim();

        if (rawLabel || rawPrompt) {
          label = rawLabel || rawPrompt;
          prompt = rawPrompt || rawLabel || entry;
        }
      }

      return {
        label,
        prompt,
        ...(index === 0 ? { icon: "sparkle" as const } : {}),
      };
    });
};

export function MyChat() {
  const { token, user } = useAuth();
  const {
    settings: appearanceSettings,
    setActiveWorkflow: setAppearanceWorkflow,
    activeWorkflow: activeAppearanceWorkflow,
  } = useAppearanceSettings();
  const { openSidebar, setHideSidebar } = useAppLayout();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [workflowSelection, setWorkflowSelection] = useState<WorkflowActivation>({
    kind: "local",
    workflow: null,
  });
  const latestWorkflowSelectionRef = useRef<WorkflowActivation>(workflowSelection);
  const activeWorkflow: WorkflowSummary | null =
    workflowSelection.kind === "local" ? workflowSelection.workflow : null;
  const activeWorkflowSlug =
    workflowSelection.kind === "local"
      ? workflowSelection.workflow?.slug ?? null
      : workflowSelection.slug;
  const activeWorkflowId =
    workflowSelection.kind === "local"
      ? workflowSelection.workflow?.id ?? null
      : null;
  const hostedWorkflowSlug =
    workflowSelection.kind === "hosted" ? workflowSelection.slug : null;
  const [workflowModes, setWorkflowModes] = useState<Record<string, HostedFlowMode>>({});
  const [chatInstances, setChatInstances] = useState<ChatInstancesState>({});
  const chatInstancesRef = useRef<ChatInstancesState>({});
  const previousSessionOwnerRef = useRef<string | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const stopVoiceSessionRef = useRef<(() => void) | null>(null);
  const resetChatStateRef = useRef<((options?: ResetChatStateOptions) => void) | null>(null);

  useEffect(() => {
    latestWorkflowSelectionRef.current = workflowSelection;
  }, [workflowSelection]);

  useEffect(() => {
    chatInstancesRef.current = chatInstances;
  }, [chatInstances]);

  // Detect outbound calls via WebSocket events (like voice sessions)
  const handleOutboundTranscript = useCallback(() => {
    requestRefreshRef.current?.("[OutboundCall] Transcription en direct");
  }, []);

  const { callId: outboundCallId, isActive: outboundCallIsActive } = useOutboundCallSession({
    onTranscript: handleOutboundTranscript,
  });

  const handleOutboundCallEnd = useCallback(() => {
    // Refresh the thread to show final transcriptions and audio links
    requestRefreshRef.current?.("[OutboundCall] Appel terminé");
  }, []);

  const handleHostedFlowDisabled = useCallback(() => {
    resetChatStateRef.current?.({
      selection: latestWorkflowSelectionRef.current,
      targetMode: "hosted",
    });
  }, []);

  const { mode, setMode, hostedFlowEnabled, disableHostedFlow } = useHostedFlow({
    onDisable: handleHostedFlowDisabled,
  });

  const appearanceWorkflowReference = useMemo<AppearanceWorkflowReference>(() => {
    if (mode === "hosted") {
      return hostedWorkflowSlug ? { kind: "hosted", slug: hostedWorkflowSlug } : null;
    }
    if (activeWorkflowId != null) {
      return { kind: "local", id: activeWorkflowId };
    }
    return null;
  }, [activeWorkflowId, hostedWorkflowSlug, mode]);

  useEffect(() => {
    const desired = appearanceWorkflowReference;
    const current = activeAppearanceWorkflow;
    const isSame =
      (!desired && !current) ||
      (desired?.kind === "local" &&
        current?.kind === "local" &&
        desired.id === current.id) ||
      (desired?.kind === "hosted" &&
        current?.kind === "hosted" &&
        desired.slug === current.slug);

    if (isSame) {
      return;
    }

    void setAppearanceWorkflow(desired);
  }, [
    activeAppearanceWorkflow,
    appearanceWorkflowReference,
    setAppearanceWorkflow,
  ]);

  const persistenceSlug = resolvePersistenceSlug(mode, workflowSelection);
  const sessionStorageKey = buildSessionStorageKey(sessionOwner, persistenceSlug);
  const activeInstanceId = buildChatInstanceId(mode, workflowSelection);
  const activeInstance = chatInstances[activeInstanceId];
  const activeInstanceIdRef = useRef(activeInstanceId);

  useEffect(() => {
    activeInstanceIdRef.current = activeInstanceId;
  }, [activeInstanceId]);

  useEffect(() => {
    requestRefreshRef.current = null;
  }, [activeInstanceId]);

  const resetChatState = useCallback(
    ({
      selection,
      preserveStoredThread = false,
      targetMode,
    }: ResetChatStateOptions = {}) => {
      const effectiveMode = targetMode ?? mode;
      const effectiveSelection = selection ?? workflowSelection;
      const persistence = resolvePersistenceSlug(effectiveMode, effectiveSelection);
      const instanceId = buildChatInstanceId(effectiveMode, effectiveSelection);
      const storageKey = buildSessionStorageKey(sessionOwner, persistence);

      clearStoredChatKitSecret(storageKey);

      if (!preserveStoredThread) {
        clearStoredThreadId(sessionOwner, persistence);
      }

      const nextInitialThreadId = preserveStoredThread
        ? loadStoredThreadId(sessionOwner, persistence)
        : null;

      setChatInstances((current) => {
        const existing = current[instanceId];
        const baseEntry =
          existing ??
          createChatInstanceEntry({
            selection: effectiveSelection,
            mode: effectiveMode,
            persistenceSlug: persistence,
            initialThreadId: nextInitialThreadId,
          });

        const nextThreadStatus = nextInitialThreadId ? baseEntry.threadStatus : null;
        const nextEntry: ChatInstanceEntry = {
          ...baseEntry,
          selection: effectiveSelection,
          mode: effectiveMode,
          persistenceSlug: persistence,
          chatInstanceKey: baseEntry.chatInstanceKey + 1,
          initialThreadId: nextInitialThreadId,
          threadStatus: nextThreadStatus,
          hasActiveThread: computeHasActiveThread(
            nextInitialThreadId,
            nextThreadStatus,
          ),
        };

        if (instanceId !== activeInstanceIdRef.current && !nextEntry.hasActiveThread) {
          const { [instanceId]: _removed, ...rest } = current;
          return rest;
        }

        return { ...current, [instanceId]: nextEntry };
      });

      // Arrêter la session vocale si elle est en cours
      stopVoiceSessionRef.current?.();
    },
    [mode, sessionOwner, stopVoiceSessionRef, workflowSelection],
  );

  useEffect(() => {
    resetChatStateRef.current = resetChatState;
    return () => {
      if (resetChatStateRef.current === resetChatState) {
        resetChatStateRef.current = null;
      }
    };
  }, [resetChatState]);

  const handleInstanceThreadChange = useCallback(
    (instanceId: string, persistence: string | null, threadId: string | null) => {
      persistStoredThreadId(sessionOwner, threadId, persistence);

      setChatInstances((current) => {
        const existing = current[instanceId];
        if (!existing) {
          return current;
        }

        const nextThreadStatus = threadId ? existing.threadStatus : null;
        const nextHasActiveThread = computeHasActiveThread(
          threadId,
          nextThreadStatus,
        );
        const nextEntry: ChatInstanceEntry = {
          ...existing,
          initialThreadId: threadId,
          threadStatus: nextThreadStatus,
          hasActiveThread: nextHasActiveThread,
        };

        if (instanceId !== activeInstanceIdRef.current && !nextHasActiveThread) {
          const { [instanceId]: _removed, ...rest } = current;
          return rest;
        }

        if (
          existing.initialThreadId === nextEntry.initialThreadId &&
          existing.threadStatus === nextEntry.threadStatus &&
          existing.hasActiveThread === nextEntry.hasActiveThread
        ) {
          return current;
        }

        return { ...current, [instanceId]: nextEntry };
      });
    },
    [sessionOwner],
  );

  const handleInstanceThreadStatusUpdate = useCallback(
    (
      instanceId: string,
      persistence: string | null,
      status: string | null,
      threadId?: string | null,
    ) => {
      if (threadId !== undefined) {
        persistStoredThreadId(sessionOwner, threadId, persistence);
      }

      setChatInstances((current) => {
        const existing = current[instanceId];
        if (!existing) {
          return current;
        }

        const nextThreadId = threadId ?? existing.initialThreadId;
        const normalizedStatus = status ?? existing.threadStatus;
        const nextHasActiveThread = computeHasActiveThread(
          nextThreadId,
          normalizedStatus,
        );
        const nextEntry: ChatInstanceEntry = {
          ...existing,
          initialThreadId: nextThreadId,
          threadStatus: normalizedStatus,
          hasActiveThread: nextHasActiveThread,
        };

        if (instanceId !== activeInstanceIdRef.current && !nextHasActiveThread) {
          const { [instanceId]: _removed, ...rest } = current;
          return rest;
        }

        if (
          existing.initialThreadId === nextEntry.initialThreadId &&
          existing.threadStatus === nextEntry.threadStatus &&
          existing.hasActiveThread === nextEntry.hasActiveThread
        ) {
          return current;
        }

        return { ...current, [instanceId]: nextEntry };
      });
    },
    [sessionOwner],
  );

  const handleRequestRefreshChange = useCallback(
    (
      instanceId: string,
      requestRefresh: ((context?: string) => Promise<void> | undefined) | null,
    ) => {
      if (instanceId === activeInstanceIdRef.current) {
        requestRefreshRef.current = requestRefresh;
        return;
      }

      if (requestRefreshRef.current && requestRefreshRef.current === requestRefresh) {
        requestRefreshRef.current = null;
      }
    },
    [],
  );

  const triggerRequestRefresh = useCallback((context?: string) => {
    requestRefreshRef.current?.(context);
  }, []);

  useEffect(() => {
    const key = normalizeWorkflowStorageKey(
      resolvePersistenceSlug(mode, workflowSelection),
    );
    setWorkflowModes((current) => {
      if (current[key] === mode) {
        return current;
      }
      return { ...current, [key]: mode };
    });
  }, [mode, workflowSelection]);

  useEffect(() => {
    const instanceId = buildChatInstanceId(mode, workflowSelection);
    const persistence = resolvePersistenceSlug(mode, workflowSelection);
    setChatInstances((current) => {
      const existing = current[instanceId];
      const storedThreadId =
        existing?.initialThreadId ?? loadStoredThreadId(sessionOwner, persistence);
      const threadStatus = existing?.threadStatus ?? null;
      const chatInstanceKey = existing?.chatInstanceKey ?? 0;
      const hasActiveThread = computeHasActiveThread(storedThreadId, threadStatus);

      const nextEntry: ChatInstanceEntry = {
        selection: workflowSelection,
        mode,
        chatInstanceKey,
        initialThreadId: storedThreadId,
        threadStatus,
        hasActiveThread,
        persistenceSlug: persistence,
      };

      if (
        existing &&
        existing.selection === workflowSelection &&
        existing.mode === mode &&
        existing.chatInstanceKey === nextEntry.chatInstanceKey &&
        existing.initialThreadId === nextEntry.initialThreadId &&
        existing.threadStatus === nextEntry.threadStatus &&
        existing.hasActiveThread === nextEntry.hasActiveThread &&
        existing.persistenceSlug === persistence
      ) {
        return current;
      }

      return { ...current, [instanceId]: nextEntry };
    });
  }, [mode, sessionOwner, workflowSelection]);

  const { getClientSecret, isLoading, error, reportError, resetError } = useChatkitSession({
    sessionOwner,
    storageKey: sessionStorageKey,
    token,
    mode,
    hostedWorkflowSlug: workflowSelection.kind === "hosted" ? workflowSelection.slug : null,
    disableHostedFlow,
  });

  const { stopVoiceSession, status: voiceStatus, isListening: voiceIsListening } = useWorkflowVoiceSession({
    threadId: activeInstance?.initialThreadId ?? null,
    onError: reportError,
    onTranscriptsUpdated: () => {
      requestRefreshRef.current?.("[Voice] Nouvelles transcriptions");
    },
  });

  // Garder stopVoiceSession dans un ref pour éviter les dépendances circulaires
  useEffect(() => {
    stopVoiceSessionRef.current = stopVoiceSession;
  }, [stopVoiceSession]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = preferredColorScheme;
  }, [preferredColorScheme]);

  const handleWorkflowActivated = useCallback(
    (selection: WorkflowActivation, { reason }: { reason: "initial" | "user" }) => {
      setWorkflowSelection((current) => {
        if (selection.kind === "hosted") {
          const wasHosted = current.kind === "hosted";
          if (mode !== "hosted") {
            setMode("hosted");
          }
          if (reason === "user" && !wasHosted) {
            resetChatState({
              selection,
              preserveStoredThread: true,
              targetMode: "hosted",
            });
            resetError();
          }
          return selection;
        }

        const workflow = selection.workflow;
        const previousWorkflow = current.kind === "local" ? current.workflow : null;
        const currentId = previousWorkflow?.id ?? null;
        const nextId = workflow?.id ?? null;

        const workflowSlug = workflow?.slug ?? null;
        const workflowKey = normalizeWorkflowStorageKey(workflowSlug);
        const defaultModeForWorkflow = reason === "initial" ? mode : "local";
        const nextMode = workflowModes[workflowKey] ?? defaultModeForWorkflow;

        if (nextMode !== mode) {
          setMode(nextMode);
        }

        // Reset chat state when workflow changes (for both user selection and initial LTI auto-selection)
        // This ensures the correct thread is loaded for LTI users when they return
        if ((reason === "user" || reason === "initial") && currentId !== nextId && nextId !== null) {
          resetChatState({
            selection,
            preserveStoredThread: true,
            targetMode: nextMode,
          });
          resetError();
        }

        return selection;
      });
    },
    [mode, resetChatState, resetError, setMode, workflowModes],
  );

  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;
    if (previousOwner && previousOwner !== sessionOwner) {
      Object.values(chatInstancesRef.current).forEach((entry) => {
        clearStoredChatKitSecret(
          buildSessionStorageKey(previousOwner, entry.persistenceSlug),
        );
        clearStoredThreadId(previousOwner, entry.persistenceSlug);
      });
    }
    previousSessionOwnerRef.current = sessionOwner;

    setChatInstances((current) => {
      let changed = false;
      const nextEntries: ChatInstancesState = {};

      for (const [instanceId, entry] of Object.entries(current)) {
        const storedThreadId = loadStoredThreadId(sessionOwner, entry.persistenceSlug);
        const nextHasActiveThread = computeHasActiveThread(
          storedThreadId,
          entry.threadStatus,
        );
        const nextEntry: ChatInstanceEntry = {
          ...entry,
          initialThreadId: storedThreadId,
          hasActiveThread: nextHasActiveThread,
        };

        if (
          nextEntry.initialThreadId !== entry.initialThreadId ||
          nextEntry.hasActiveThread !== entry.hasActiveThread
        ) {
          changed = true;
        }

        nextEntries[instanceId] = nextEntry;
      }

      return changed ? nextEntries : current;
    });
  }, [sessionOwner]);

  const { apiConfig, attachmentsEnabled, debugSnapshot } = useChatApiConfig({
    token,
    hostedFlowEnabled,
    getClientSecret,
    missingDomainKeyWarningShownRef,
  });

  const debugSignature = useMemo(() => JSON.stringify(debugSnapshot), [debugSnapshot]);

  useEffect(() => {
    console.info("[ChatKit] Configuration résolue pour le widget", debugSnapshot);
  }, [debugSignature, debugSnapshot]);

  const attachmentsConfig = useMemo<AttachmentsConfig>(
    () =>
      attachmentsEnabled
        ? {
            enabled: true,
            maxCount: 4,
            maxSize: 10 * 1024 * 1024,
            accept: {
              "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
              "application/pdf": [".pdf"],
              "text/plain": [".txt", ".md"],
            },
          }
        : { enabled: false },
    [attachmentsEnabled],
  );

  const composerPlaceholder = useMemo(() => {
    const candidate = appearanceSettings.start_screen_placeholder?.trim();
    return candidate && candidate.length > 0
      ? candidate
      : "Posez votre question...";
  }, [appearanceSettings.start_screen_placeholder]);


  const voiceStatusMessage = voiceStatus === "connected"
    ? `Session vocale active${voiceIsListening ? " - En écoute" : ""}`
    : voiceStatus === "connecting"
    ? "Connexion audio en cours..."
    : null;

  // Apply LTI sidebar visibility setting
  useEffect(() => {
    const isLtiContext = user?.email.endsWith('@lti.local') ?? false;
    const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiContext;
    const shouldHideSidebar = shouldApplyLtiOptions && !activeWorkflow?.lti_show_sidebar;

    setHideSidebar(shouldHideSidebar);

    // Cleanup: restore sidebar when unmounting or when conditions change
    return () => {
      setHideSidebar(false);
    };
  }, [activeWorkflow?.lti_enabled, activeWorkflow?.lti_show_sidebar, user?.email, setHideSidebar]);

  return (
    <>
      <ChatSidebar
        mode={mode}
        setMode={setMode}
        onWorkflowActivated={handleWorkflowActivated}
      />
      {Object.entries(chatInstances).map(([instanceId, entry]) => (
        <WorkflowChatInstance
          key={instanceId}
          instanceId={instanceId}
          entry={entry}
          apiConfig={apiConfig}
          attachmentsConfig={attachmentsConfig}
          appearanceSettings={appearanceSettings}
          composerPlaceholder={composerPlaceholder}
          preferredColorScheme={preferredColorScheme}
          token={token}
          openSidebar={openSidebar}
          userEmail={user?.email}
          reportError={reportError}
          resetError={resetError}
          onThreadChange={handleInstanceThreadChange}
          onThreadStatusUpdate={handleInstanceThreadStatusUpdate}
          onRequestRefreshChange={handleRequestRefreshChange}
          onTriggerRefresh={triggerRequestRefresh}
          isActive={instanceId === activeInstanceId}
        />
      ))}
      {voiceStatusMessage && (
        <div style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          padding: "12px 16px",
          background: voiceStatus === "connected" ? "#10a37f" : "#ff9800",
          color: "white",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          fontSize: "14px",
          fontWeight: 500,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "white",
            animation: voiceIsListening ? "pulse 1.5s infinite" : "none",
          }} />
          {voiceStatusMessage}
          <button
            type="button"
            onClick={stopVoiceSession}
            style={{
              marginLeft: "8px",
              padding: "4px 8px",
              background: "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Arrêter
          </button>
        </div>
      )}
      {outboundCallIsActive && outboundCallId && (
        <OutboundCallAudioPlayer
          callId={outboundCallId}
          onCallEnd={handleOutboundCallEnd}
          authToken={token}
        />
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </>
  );
}

type WorkflowChatInstanceProps = {
  instanceId: string;
  entry: ChatInstanceEntry;
  apiConfig: ChatKitOptions["api"];
  attachmentsConfig: AttachmentsConfig;
  appearanceSettings: AppearanceSettings;
  composerPlaceholder: string;
  preferredColorScheme: ResolvedColorScheme;
  token: string | null;
  openSidebar: () => void;
  userEmail: string | undefined;
  reportError: (message: string, detail?: unknown) => void;
  resetError: () => void;
  onThreadChange: (
    instanceId: string,
    persistenceSlug: string | null,
    threadId: string | null,
  ) => void;
  onThreadStatusUpdate: (
    instanceId: string,
    persistenceSlug: string | null,
    status: string | null,
    threadId?: string | null,
  ) => void;
  onRequestRefreshChange: (
    instanceId: string,
    requestRefresh: ((context?: string) => Promise<void> | undefined) | null,
  ) => void;
  onTriggerRefresh: (context?: string) => void;
  isActive: boolean;
};

const WorkflowChatInstance = ({
  instanceId,
  entry,
  apiConfig,
  attachmentsConfig,
  appearanceSettings,
  composerPlaceholder,
  preferredColorScheme,
  token,
  openSidebar,
  userEmail,
  reportError,
  resetError,
  onThreadChange,
  onThreadStatusUpdate,
  onRequestRefreshChange,
  onTriggerRefresh,
  isActive,
}: WorkflowChatInstanceProps) => {
  const { selection, mode, chatInstanceKey, initialThreadId, persistenceSlug } = entry;
  const activeWorkflow =
    selection.kind === "local" ? selection.workflow : null;
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);

  const chatkitOptions = useMemo(() => {
    const colorScheme = resolveThemeColorScheme(
      appearanceSettings,
      preferredColorScheme,
    );
    const surfacePalette = buildSurfacePalette(appearanceSettings);
    const surface = resolveSurfaceColors(surfacePalette, colorScheme);
    const greeting = normalizeText(appearanceSettings.start_screen_greeting);
    const prompts = parseStartScreenPrompts(
      appearanceSettings.start_screen_prompt,
    );
    const disclaimerText = normalizeText(
      appearanceSettings.start_screen_disclaimer,
    );

    const isLtiContext = userEmail?.endsWith("@lti.local") ?? false;
    const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiContext;

    return {
      api: apiConfig,
      initialThread: initialThreadId,
      ...(shouldApplyLtiOptions && !activeWorkflow?.lti_show_header
        ? { header: { enabled: false } }
        : {
            header: {
              leftAction: {
                icon: "menu",
                onClick: openSidebar,
              },
            },
          }),
      ...(shouldApplyLtiOptions && !activeWorkflow?.lti_enable_history
        ? { history: { enabled: false } }
        : {}),
      theme: {
        colorScheme,
        radius: "pill",
        density: "normal",
        color: {
          accent: {
            primary: appearanceSettings.accent_color,
            level: 1,
          },
          surface: {
            background: surface.background,
            foreground: surface.foreground,
          },
        },
        typography: {
          baseSize: 16,
          fontFamily: appearanceSettings.body_font,
          fontFamilyMono:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
        },
      },
      startScreen:
        greeting || prompts.length > 0
          ? {
              ...(greeting ? { greeting } : {}),
              ...(prompts.length > 0 ? { prompts } : {}),
            }
          : undefined,
      disclaimer: disclaimerText ? { text: disclaimerText } : undefined,
      composer: {
        placeholder: composerPlaceholder,
        attachments: attachmentsConfig,
      },
      onClientTool: async (toolCall) => {
        const { name, params } = toolCall as ClientToolCall;

        switch (name) {
          case "get_weather": {
            const city = params?.city?.trim();
            const country = params?.country?.trim();

            if (!city) {
              throw new Error(
                "Le paramètre 'city' est requis pour l'outil météo.",
              );
            }

            const searchParams = new URLSearchParams({ city });
            if (country) {
              searchParams.set("country", country);
            }

            const response = await fetch(
              `/api/tools/weather?${searchParams.toString()}`,
            );
            if (!response.ok) {
              const details = await response.text();
              throw new Error(
                `Échec de l'appel météo (${response.status}) : ${
                  details || "réponse vide"
                }`,
              );
            }

            return response.json();
          }
          default:
            throw new Error(`Outil client non pris en charge : ${name}`);
        }
      },
      onError: ({ error }: { error: Error }) => {
        console.groupCollapsed("[ChatKit] onError");
        console.error("error:", error);
        if (lastThreadSnapshotRef.current) {
          console.log("thread snapshot:", lastThreadSnapshotRef.current);
        }
        console.groupEnd();
        reportError(error.message, error);
      },
      onResponseStart: () => {
        resetError();
      },
      onResponseEnd: () => {
        console.debug("[ChatKit] response end");
        onTriggerRefresh("[ChatKit] Échec de la synchronisation après la réponse");
      },
      onThreadChange: ({ threadId }: { threadId: string | null }) => {
        console.debug("[ChatKit] thread change", { threadId, instanceId });
        onThreadChange(instanceId, persistenceSlug, threadId);
      },
      onThreadLoadStart: ({ threadId }: { threadId: string }) => {
        console.debug("[ChatKit] thread load start", { threadId, instanceId });
      },
      onThreadLoadEnd: ({ threadId }: { threadId: string }) => {
        console.debug("[ChatKit] thread load end", { threadId, instanceId });
      },
      onLog: (entry: { name: string; data?: Record<string, unknown> }) => {
        console.log('[MyChat] onLog called:', entry.name, {
          hasData: !!entry.data,
          dataKeys: entry.data ? Object.keys(entry.data) : [],
        });

        if (entry?.data && typeof entry.data === "object") {
          const data = entry.data as Record<string, unknown>;
          if ("thread" in data && data.thread) {
            const thread = data.thread as Record<string, unknown>;
            lastThreadSnapshotRef.current = thread;

            const status = typeof thread.status === "string" ? thread.status : null;
            const threadId =
              typeof (thread as { id?: unknown }).id === "string"
                ? (thread as { id: string }).id
                : typeof (thread as { thread_id?: unknown }).thread_id === "string"
                ? (thread as { thread_id: string }).thread_id
                : null;

            console.log('[MyChat] Thread updated:', {
              keys: Object.keys(thread),
              hasItems: 'items' in thread,
              hasMessages: 'messages' in thread,
              itemsLength: Array.isArray((thread as { items?: unknown }).items)
                ? ((thread as { items?: unknown[] }).items ?? []).length
                : 'N/A',
              messagesLength: Array.isArray((thread as { messages?: unknown }).messages)
                ? ((thread as { messages?: unknown[] }).messages ?? []).length
                : 'N/A',
              firstItem:
                Array.isArray((thread as { items?: unknown[] }).items) &&
                ((thread as { items?: unknown[] }).items ?? []).length > 0
                  ? ((thread as { items?: unknown[] }).items ?? [])[0]
                  : null,
            });

            onThreadStatusUpdate(instanceId, persistenceSlug, status, threadId);
          }
        }

        console.debug("[ChatKit] log", entry.name, entry.data ?? {});
      },
    } satisfies ChatKitOptions;
  }, [
    activeWorkflow?.lti_enable_history,
    activeWorkflow?.lti_enabled,
    activeWorkflow?.lti_show_header,
    appearanceSettings,
    apiConfig,
    attachmentsConfig,
    composerPlaceholder,
    instanceId,
    initialThreadId,
    onThreadChange,
    onThreadStatusUpdate,
    onTriggerRefresh,
    openSidebar,
    persistenceSlug,
    preferredColorScheme,
    reportError,
    resetError,
    selection,
    userEmail,
  ]);

  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow,
    initialThreadId,
    reportError,
    mode,
  });

  useEffect(() => {
    onRequestRefreshChange(instanceId, isActive ? requestRefresh : null);
    return () => {
      onRequestRefreshChange(instanceId, null);
    };
  }, [instanceId, isActive, onRequestRefreshChange, requestRefresh]);

  return (
    <ChatKitHost
      control={control}
      chatInstanceKey={chatInstanceKey}
      instanceId={instanceId}
      style={isActive ? undefined : { display: "none" }}
    />
  );
};
