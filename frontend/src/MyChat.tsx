import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ChatKitOptions } from "./chatkit";
import type { Thread } from "./chatkit/types";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { LoadingOverlay } from "./components/feedback/LoadingOverlay";
import { WorkflowChatInstance } from "./components/my-chat/WorkflowChatInstance";
import { WorkflowSelector } from "./components/my-chat/WorkflowSelector";
import { ChatWorkflowSidebar, type WorkflowActivation } from "./features/workflows/WorkflowSidebar";
import type { ThreadWorkflowMetadata } from "./features/workflows/ConversationsSidebarSection";
import {
  useAppearanceSettings,
  type AppearanceWorkflowReference,
} from "./features/appearance/AppearanceSettingsContext";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow, type HostedFlowMode } from "./hooks/useHostedFlow";
import { useWorkflowVoiceSession } from "./hooks/useWorkflowVoiceSession";
import { useOutboundCallSession } from "./hooks/useOutboundCallSession";
import { useWorkflowCapabilities } from "./hooks/useWorkflowCapabilities";
import { useChatApiConfig } from "./hooks/useChatApiConfig";
import { useWorkflowSidebar } from "./features/workflows/WorkflowSidebarProvider";
import { useLtiContext } from "./hooks/useLtiContext";
import { useChatTheme } from "./hooks/useChatTheme";
import { useChatkitCallbacks } from "./hooks/useChatkitCallbacks";
import { useChatInstanceCache } from "./hooks/useChatInstanceCache";
import { useChatkitWidgets } from "./hooks/useChatkitWidgets";
import { getOrCreateDeviceId } from "./utils/device";
import { loadComposerModelsConfig } from "./utils/composerModels";
import { useWorkflowComposerModels } from "./hooks/useWorkflowComposerModels";
import { clearStoredChatKitSecret } from "./utils/chatkitSession";
import { workflowsApi } from "./utils/backend";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import type { WorkflowSummary } from "./types/workflows";

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

export function MyChat() {
  const { threadId: urlThreadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const {
    settings: appearanceSettings,
    setActiveWorkflow: setAppearanceWorkflow,
    activeWorkflow: activeAppearanceWorkflow,
  } = useAppearanceSettings();
  const { openSidebar, setHideSidebar, isSidebarOpen } = useAppLayout();
  const { loading: workflowsLoading, workflows, selectedWorkflowId: providerSelectedWorkflowId, setSelectedWorkflowId } = useWorkflowSidebar();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;

  // Workflow selection state
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
  const [chatInstanceKey, setChatInstanceKey] = useState(0);

  // Thread state
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const [currentThread, setCurrentThread] = useState<Record<string, unknown> | null>(null);
  const [streamingThreadIds, setStreamingThreadIds] = useState<Set<string>>(new Set());
  const [isNewConversationStreaming, setIsNewConversationStreaming] = useState(false);
  const wasNewConversationStreamingRef = useRef(false);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const stopVoiceSessionRef = useRef<(() => void) | null>(null);
  const resetChatStateRef = useRef<((options?: ResetChatStateOptions) => void) | null>(null);
  const isNewConversationDraftRef = useRef<boolean>(false);
  const isInitialMountRef = useRef<boolean>(true);

  // LTI context
  const isLtiUser = user?.is_lti ?? false;
  const { isLtiContext, shouldShowLoadingOverlay } = useLtiContext({
    isLtiUser,
    activeWorkflow,
    workflowsLoading,
    setHideSidebar,
  });

  // Theme
  const themeConfig = useChatTheme({
    appearanceSettings,
    preferredColorScheme,
  });

  useEffect(() => {
    latestWorkflowSelectionRef.current = workflowSelection;
  }, [workflowSelection]);

  // Outbound call handlers
  const handleOutboundTranscript = useCallback(() => {
    requestRefreshRef.current?.("[OutboundCall] Transcription en direct");
  }, []);

  const handleOutboundCallEnd = useCallback(() => {
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

  // Appearance workflow sync
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
      (desired?.kind === "local" && current?.kind === "local" && desired.id === current.id) ||
      (desired?.kind === "hosted" && current?.kind === "hosted" && desired.slug === current.slug);

    if (!isSame) {
      void setAppearanceWorkflow(desired);
    }
  }, [activeAppearanceWorkflow, appearanceWorkflowReference, setAppearanceWorkflow]);

  const persistenceSlug = resolvePersistenceSlug(mode, workflowSelection);
  const sessionStorageKey = buildSessionStorageKey(sessionOwner, persistenceSlug);

  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    urlThreadId ?? loadStoredThreadId(sessionOwner, persistenceSlug),
  );

  const prevUrlThreadIdRef = useRef<string | undefined>(urlThreadId);

  // URL sync effect
  useEffect(() => {
    const prevUrlThreadId = prevUrlThreadIdRef.current;
    prevUrlThreadIdRef.current = urlThreadId;

    if (prevUrlThreadId === urlThreadId) return;

    const currentUrlThreadId = urlThreadId ?? null;

    if (currentUrlThreadId !== null && currentUrlThreadId !== initialThreadId) {
      isNewConversationDraftRef.current = false;
      persistStoredThreadId(sessionOwner, currentUrlThreadId, persistenceSlug);
      setInitialThreadId(currentUrlThreadId);
      setChatInstanceKey((v) => v + 1);
      return;
    }

    if (currentUrlThreadId === null && prevUrlThreadId !== undefined) {
      clearStoredThreadId(sessionOwner, persistenceSlug);
      isNewConversationDraftRef.current = true;
      setInitialThreadId(null);
      setChatInstanceKey((v) => v + 1);
    }
  }, [urlThreadId, initialThreadId, sessionOwner, persistenceSlug]);

  // Debug logging
  useEffect(() => {
    if (currentThread) {
      const metadata = currentThread.metadata as Record<string, unknown> | undefined;
      console.debug("[MyChat] currentThread changed:", {
        id: currentThread.id,
        title: currentThread.title,
        metadataTitle: metadata?.title,
        initialThreadId,
      });
    }
  }, [currentThread, initialThreadId]);

  useEffect(() => {
    if (!isInitialMountRef.current) {
      isNewConversationDraftRef.current = initialThreadId === null;
    }
  }, [initialThreadId]);

  // Reset chat state
  const resetChatState = useCallback(
    ({ selection, preserveStoredThread = false, targetMode }: ResetChatStateOptions = {}) => {
      const effectiveMode = targetMode ?? mode;
      const effectiveSelection = selection ?? workflowSelection;
      const resolvedSlug = resolvePersistenceSlug(effectiveMode, effectiveSelection);
      const storageKey = buildSessionStorageKey(sessionOwner, resolvedSlug);

      clearStoredChatKitSecret(storageKey);
      if (!preserveStoredThread) {
        clearStoredThreadId(sessionOwner, resolvedSlug);
      }

      lastThreadSnapshotRef.current = null;
      setCurrentThread(null);
      setStreamingThreadIds(new Set());
      setIsNewConversationStreaming(false);
      wasNewConversationStreamingRef.current = false;

      const nextInitialThreadId = preserveStoredThread
        ? loadStoredThreadId(sessionOwner, resolvedSlug)
        : null;
      setInitialThreadId(nextInitialThreadId);
      setChatInstanceKey((v) => v + 1);
      stopVoiceSessionRef.current?.();
    },
    [mode, sessionOwner, workflowSelection],
  );

  useEffect(() => {
    resetChatStateRef.current = resetChatState;
    return () => {
      if (resetChatStateRef.current === resetChatState) {
        resetChatStateRef.current = null;
      }
    };
  }, [resetChatState]);

  useEffect(() => {
    const key = normalizeWorkflowStorageKey(resolvePersistenceSlug(mode, workflowSelection));
    setWorkflowModes((current) => (current[key] === mode ? current : { ...current, [key]: mode }));
  }, [mode, workflowSelection]);

  const { getClientSecret, reportError, resetError } = useChatkitSession({
    sessionOwner,
    storageKey: sessionStorageKey,
    token,
    mode,
    hostedWorkflowSlug: workflowSelection.kind === "hosted" ? workflowSelection.slug : null,
    disableHostedFlow,
  });

  const { hasVoiceAgent, hasOutboundCall } = useWorkflowCapabilities(
    token,
    activeWorkflow?.id ?? null,
    activeWorkflow?.active_version_id ?? null,
  );

  const {
    startVoiceSession,
    stopVoiceSession,
    status: voiceStatus,
    isListening: voiceIsListening,
    transcripts: voiceTranscripts,
    interruptSession: interruptVoiceSession,
    transportError: voiceTransportError,
  } = useWorkflowVoiceSession({
    enabled: hasVoiceAgent,
    threadId: (currentThread?.id as string | undefined) ?? initialThreadId,
    onError: reportError,
    onTranscriptsUpdated: () => {
      requestRefreshRef.current?.("[Voice] Nouvelles transcriptions");
    },
  });

  const {
    callId: outboundCallId,
    isActive: outboundCallIsActive,
    status: outboundCallStatus,
    toNumber: outboundCallToNumber,
    transcripts: outboundCallTranscripts,
    error: outboundCallError,
    hangupCall: hangupOutboundCall,
  } = useOutboundCallSession({
    enabled: true,
    authToken: token,
    onTranscript: handleOutboundTranscript,
    onCallEnd: handleOutboundCallEnd,
  });

  useEffect(() => {
    stopVoiceSessionRef.current = stopVoiceSession;
  }, [stopVoiceSession]);

  // Workflow activation handler
  const handleWorkflowActivated = useCallback(
    (selection: WorkflowActivation, { reason }: { reason: "initial" | "user" }) => {
      const shouldPreserveStoredThread = !isNewConversationDraftRef.current;

      setWorkflowSelection((current) => {
        if (selection.kind === "hosted") {
          if (mode !== "hosted") setMode("hosted");
          if (reason === "user" && current.kind !== "hosted") {
            resetChatState({ selection, preserveStoredThread: shouldPreserveStoredThread, targetMode: "hosted" });
            resetError();
          }
          return selection;
        }

        const workflow = selection.workflow;
        const previousWorkflow = current.kind === "local" ? current.workflow : null;
        const currentId = previousWorkflow?.id ?? null;
        const nextId = workflow?.id ?? null;

        const workflowKey = normalizeWorkflowStorageKey(workflow?.slug ?? null);
        const defaultModeForWorkflow = reason === "initial" ? mode : "local";
        const nextMode = workflowModes[workflowKey] ?? defaultModeForWorkflow;

        if (nextMode !== mode) setMode(nextMode);

        if ((reason === "user" || reason === "initial") && currentId !== nextId && nextId !== null) {
          resetChatState({ selection, preserveStoredThread: shouldPreserveStoredThread, targetMode: nextMode });
          resetError();
        }

        return selection;
      });
    },
    [mode, resetChatState, resetError, setMode, workflowModes],
  );

  // Sync workflow from provider
  useEffect(() => {
    if (mode !== "local" || providerSelectedWorkflowId === null || !token) return;

    const currentId = workflowSelection.kind === "local" ? workflowSelection.workflow?.id ?? null : null;
    if (currentId === providerSelectedWorkflowId) return;

    const workflow = workflows.find((w) => w.id === providerSelectedWorkflowId) ?? null;
    if (workflow) {
      if (user?.is_admin) {
        workflowsApi.setChatkitWorkflow(token, providerSelectedWorkflowId).catch(console.error);
      }

      const selection: WorkflowActivation = { kind: "local", workflow };
      resetChatState({ selection, preserveStoredThread: !isNewConversationDraftRef.current, targetMode: mode });
      resetError();
      setWorkflowSelection(selection);
    }
  }, [mode, providerSelectedWorkflowId, workflows, workflowSelection, resetChatState, resetError, token, user?.is_admin]);

  // Session owner change effect
  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;
    if (previousOwner && previousOwner !== sessionOwner) {
      clearStoredChatKitSecret(buildSessionStorageKey(previousOwner, "hosted"));
      clearStoredThreadId(previousOwner, "hosted");
      clearStoredChatKitSecret(buildSessionStorageKey(previousOwner, persistenceSlug));
      clearStoredThreadId(previousOwner, persistenceSlug);
    }
    previousSessionOwnerRef.current = sessionOwner;

    if (!isInitialMountRef.current && isNewConversationDraftRef.current) return;

    const storedThreadId = loadStoredThreadId(sessionOwner, persistenceSlug);
    if (storedThreadId) {
      isInitialMountRef.current = false;
      isNewConversationDraftRef.current = false;
      setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
    } else if (isInitialMountRef.current && persistenceSlug) {
      isInitialMountRef.current = false;
    }
  }, [persistenceSlug, sessionOwner]);

  const { apiConfig, attachmentsEnabled, debugSnapshot } = useChatApiConfig({
    token,
    hostedFlowEnabled,
    getClientSecret,
    missingDomainKeyWarningShownRef,
  });

  const sidebarApiConfig = useMemo(() => {
    if (!token) return null;
    return {
      url: debugSnapshot.apiUrl || "/api/chatkit",
      headers: { Authorization: `Bearer ${token}` },
    };
  }, [token, debugSnapshot.apiUrl]);

  // Sidebar thread handlers
  const handleSidebarThreadSelect = useCallback(
    async (threadId: string, workflowMetadata?: ThreadWorkflowMetadata) => {
      isNewConversationDraftRef.current = false;

      const currentWorkflowId = workflowSelection.kind === "local" ? workflowSelection.workflow?.id : null;
      const threadWorkflowId = workflowMetadata?.id;

      let targetSlug = persistenceSlug;
      let workflowChanged = false;

      if (threadWorkflowId != null && threadWorkflowId !== currentWorkflowId) {
        const targetWorkflow = workflows.find((w) => w.id === threadWorkflowId);
        if (targetWorkflow) {
          targetSlug = resolvePersistenceSlug(mode, { kind: "local", workflow: targetWorkflow });

          if (user?.is_admin && token) {
            await workflowsApi.setChatkitWorkflow(token, threadWorkflowId).catch(console.error);
          }

          setSelectedWorkflowId(threadWorkflowId);
          setWorkflowSelection({ kind: "local", workflow: targetWorkflow });
          workflowChanged = true;
        }
      }

      persistStoredThreadId(sessionOwner, threadId, targetSlug);
      navigate(`/c/${threadId}`, { replace: true });
      setInitialThreadId(threadId);

      if (workflowChanged) {
        setChatInstanceKey((v) => v + 1);
      }
    },
    [sessionOwner, persistenceSlug, workflowSelection, workflows, setSelectedWorkflowId, mode, token, user?.is_admin, navigate],
  );

  const handleSidebarThreadDeleted = useCallback(
    (deletedThreadId: string) => {
      const currentId = (currentThread?.id as string | undefined) ?? initialThreadId;
      if (currentId === deletedThreadId) {
        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
        setChatInstanceKey((v) => v + 1);
        navigate("/", { replace: true });
      }
    },
    [sessionOwner, persistenceSlug, currentThread, initialThreadId, navigate],
  );

  const handleNewConversation = useCallback(() => {
    clearStoredThreadId(sessionOwner, persistenceSlug);
    lastThreadSnapshotRef.current = null;
    setCurrentThread(null);
    setIsNewConversationStreaming(false);
    wasNewConversationStreamingRef.current = false;
    isNewConversationDraftRef.current = true;
    setInitialThreadId(null);
    setChatInstanceKey((v) => v + 1);
    navigate("/", { replace: true });
  }, [sessionOwner, persistenceSlug, navigate]);

  const handleWorkflowSelectorChange = useCallback(
    async (workflowId: number) => {
      const targetWorkflow = workflows.find((w) => w.id === workflowId);
      if (targetWorkflow) {
        setSelectedWorkflowId(workflowId);
        setWorkflowSelection({ kind: "local", workflow: targetWorkflow });

        if (user?.is_admin && token) {
          await workflowsApi.setChatkitWorkflow(token, workflowId).catch(console.error);
        }

        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
        setChatInstanceKey((v) => v + 1);
      }
    },
    [workflows, setSelectedWorkflowId, sessionOwner, persistenceSlug, token, user?.is_admin],
  );

  // ChatKit callbacks
  const chatkitCallbacks = useChatkitCallbacks({
    sessionOwner,
    persistenceSlug,
    refs: {
      lastThreadSnapshotRef,
      wasNewConversationStreamingRef,
      isNewConversationDraftRef,
      requestRefreshRef,
    },
    setters: {
      setCurrentThread,
      setStreamingThreadIds,
      setIsNewConversationStreaming,
      setInitialThreadId,
    },
    reportError,
    resetError,
  });

  // Widgets config
  const widgetsConfig = useChatkitWidgets({
    hasVoiceAgent,
    hasOutboundCall,
    threadId: (currentThread?.id as string | undefined) ?? initialThreadId,
    voiceSession: {
      startVoiceSession,
      stopVoiceSession,
      status: voiceStatus,
      isListening: voiceIsListening,
      transcripts: voiceTranscripts,
      interruptSession: interruptVoiceSession,
      transportError: voiceTransportError,
    },
    outboundCall: {
      callId: outboundCallId,
      isActive: outboundCallIsActive,
      status: outboundCallStatus,
      toNumber: outboundCallToNumber,
      transcripts: outboundCallTranscripts,
      error: outboundCallError,
      hangupCall: hangupOutboundCall,
    },
  });

  // Attachments config
  const attachmentsConfig = useMemo(
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
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
              "application/msword": [".doc"],
            },
          }
        : { enabled: false },
    [attachmentsEnabled],
  );

  const composerPlaceholder = useMemo(() => {
    const candidate = appearanceSettings.start_screen_placeholder?.trim();
    return candidate && candidate.length > 0 ? candidate : "Posez votre question...";
  }, [appearanceSettings.start_screen_placeholder]);

  const localStorageComposerModels = useMemo(() => loadComposerModelsConfig(), []);

  const workflowForComposer = useMemo(() => {
    if (activeWorkflow) return activeWorkflow;
    const defaultWorkflow = workflows.find((w) => w.is_chatkit_default);
    if (defaultWorkflow) return defaultWorkflow;
    if (providerSelectedWorkflowId) {
      return workflows.find((w) => w.id === providerSelectedWorkflowId) ?? null;
    }
    return null;
  }, [activeWorkflow, workflows, providerSelectedWorkflowId]);

  const { composerModels: workflowComposerModels, workflowDetected } = useWorkflowComposerModels({
    token,
    workflowId: workflowForComposer?.id ?? null,
    activeVersionId: workflowForComposer?.active_version_id ?? null,
  });

  const composerModels = workflowDetected ? workflowComposerModels : localStorageComposerModels;

  // Build ChatKit options
  const chatkitOptions = useMemo(() => {
    const isLtiContextLocal = user?.is_lti ?? false;
    const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiContextLocal;

    return {
      api: apiConfig,
      initialThread: initialThreadId,
      ...(shouldApplyLtiOptions && !activeWorkflow?.lti_show_header
        ? { header: { enabled: false } }
        : {
            header: {
              ...(isSidebarOpen ? {} : { leftAction: { icon: "menu" as const, onClick: openSidebar } }),
              ...(mode === "local" && workflows.length > 0 && initialThreadId === null
                ? {
                    customContent: (
                      <WorkflowSelector
                        workflows={workflows}
                        selectedWorkflowId={workflowSelection.kind === "local" ? workflowSelection.workflow?.id ?? null : null}
                        onWorkflowChange={handleWorkflowSelectorChange}
                      />
                    ),
                  }
                : {}),
            },
          }),
      ...(shouldApplyLtiOptions && !activeWorkflow?.lti_enable_history ? { history: { enabled: false } } : {}),
      theme: {
        colorScheme: themeConfig.colorScheme,
        radius: "pill" as const,
        density: "normal" as const,
        color: {
          accent: { primary: appearanceSettings.accent_color, level: 1 },
          surface: { background: themeConfig.surface.background, foreground: themeConfig.surface.foreground },
        },
        typography: {
          baseSize: 16,
          fontFamily: appearanceSettings.body_font,
          fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
        },
      },
      startScreen:
        themeConfig.greeting || themeConfig.prompts.length > 0
          ? {
              ...(themeConfig.greeting ? { greeting: themeConfig.greeting } : {}),
              ...(themeConfig.prompts.length > 0 ? { prompts: themeConfig.prompts } : {}),
            }
          : undefined,
      disclaimer: themeConfig.disclaimerText ? { text: themeConfig.disclaimerText } : undefined,
      composer: {
        placeholder: composerPlaceholder,
        attachments: attachmentsConfig,
        ...(composerModels ? { models: composerModels } : {}),
      },
      widgets: widgetsConfig,
      onClientTool: async (toolCall: unknown) => {
        const { name, params } = toolCall as ClientToolCall;
        if (name === "get_weather") {
          const city = params?.city?.trim();
          if (!city) throw new Error("Le paramètre 'city' est requis pour l'outil météo.");
          const searchParams = new URLSearchParams({ city });
          if (params?.country?.trim()) searchParams.set("country", params.country.trim());
          const response = await fetch(`/api/tools/weather?${searchParams.toString()}`);
          if (!response.ok) {
            const details = await response.text();
            throw new Error(`Échec de l'appel météo (${response.status}) : ${details || "réponse vide"}`);
          }
          return response.json();
        }
        throw new Error(`Outil client non pris en charge : ${name}`);
      },
      onError: chatkitCallbacks.onError,
      onResponseStart: chatkitCallbacks.onResponseStart,
      onResponseEnd: chatkitCallbacks.onResponseEnd,
      onThreadChange: chatkitCallbacks.onThreadChange,
      onThreadLoadStart: chatkitCallbacks.onThreadLoadStart,
      onThreadLoadEnd: chatkitCallbacks.onThreadLoadEnd,
      onLog: chatkitCallbacks.onLog,
      isAdmin: user?.is_admin,
    } satisfies ChatKitOptions;
  }, [
    apiConfig,
    initialThreadId,
    activeWorkflow?.lti_enabled,
    activeWorkflow?.lti_show_header,
    activeWorkflow?.lti_enable_history,
    user?.is_lti,
    user?.is_admin,
    isSidebarOpen,
    openSidebar,
    mode,
    workflows,
    workflowSelection,
    handleWorkflowSelectorChange,
    themeConfig,
    appearanceSettings.accent_color,
    appearanceSettings.body_font,
    composerPlaceholder,
    attachmentsConfig,
    composerModels,
    widgetsConfig,
    chatkitCallbacks,
  ]);

  // Instance cache
  const { currentWorkflowId, activeInstances } = useChatInstanceCache({
    mode,
    activeWorkflowId,
    hostedWorkflowSlug,
    activeWorkflow,
    initialThreadId,
    chatkitOptions,
    chatInstanceKey,
  });

  const handleRequestRefreshReady = useCallback((requestRefresh: () => Promise<void>) => {
    requestRefreshRef.current = requestRefresh;
  }, []);

  return (
    <>
      <LoadingOverlay isVisible={shouldShowLoadingOverlay} message="Chargement..." variant="fullscreen" />
      <div style={{ display: shouldShowLoadingOverlay ? "none" : "contents" }}>
        <ChatWorkflowSidebar
          mode={mode}
          setMode={setMode}
          onWorkflowActivated={handleWorkflowActivated}
          api={sidebarApiConfig}
          currentThreadId={initialThreadId === null ? null : ((currentThread?.id as string | undefined) ?? initialThreadId)}
          activeThreadSnapshot={initialThreadId === null ? null : (currentThread as Thread | null)}
          streamingThreadIds={streamingThreadIds}
          onThreadSelect={handleSidebarThreadSelect}
          onThreadDeleted={handleSidebarThreadDeleted}
          onNewConversation={handleNewConversation}
          hideWorkflows
          isNewConversationActive={initialThreadId === null}
        />
        <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            {Array.from(activeInstances.entries()).map(([instanceId, instance]) => (
              <WorkflowChatInstance
                key={instanceId}
                workflowId={instanceId}
                chatkitOptions={instanceId === currentWorkflowId ? chatkitOptions : instance.chatkitOptions}
                token={token}
                activeWorkflow={instance.workflow}
                initialThreadId={instanceId === currentWorkflowId ? initialThreadId : instance.initialThreadId}
                reportError={reportError}
                mode={instance.mode}
                isActive={instanceId === currentWorkflowId}
                autoStartEnabled={!hasVoiceAgent}
                onRequestRefreshReady={instanceId === currentWorkflowId ? handleRequestRefreshReady : undefined}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
