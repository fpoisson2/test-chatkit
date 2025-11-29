import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { ChatKitOptions } from "./chatkit";
import type { Thread } from "./chatkit/types";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { LoadingOverlay } from "./components/feedback/LoadingOverlay";
import { WorkflowChatInstance } from "./components/my-chat/WorkflowChatInstance";
import { WorkflowSelector } from "./components/my-chat/WorkflowSelector";
import { ChatWorkflowSidebar, type WorkflowActivation } from "./features/workflows/WorkflowSidebar";
import { useAppearanceSettings } from "./features/appearance/AppearanceSettingsContext";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow } from "./hooks/useHostedFlow";
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
import { useResetChatState } from "./hooks/useResetChatState";
import { useWorkflowState } from "./hooks/useWorkflowState";
import { useSidebarActions } from "./hooks/useSidebarActions";
import { getOrCreateDeviceId } from "./utils/device";
import { loadComposerModelsConfig } from "./utils/composerModels";
import { useWorkflowComposerModels } from "./hooks/useWorkflowComposerModels";
import { clearStoredChatKitSecret } from "./utils/chatkitSession";
import { clearStoredThreadId, loadStoredThreadId, persistStoredThreadId } from "./utils/chatkitThread";
import { resolvePersistenceSlug, buildSessionStorageKey } from "./utils/chatStorage";

type WeatherToolCall = {
  name: "get_weather";
  params: { city: string; country?: string | null };
};
type ClientToolCall = WeatherToolCall;

export function MyChat() {
  const { threadId: urlThreadId } = useParams<{ threadId?: string }>();
  const { token, user } = useAuth();
  const { settings: appearanceSettings, setActiveWorkflow: setAppearanceWorkflow, activeWorkflow: activeAppearanceWorkflow } = useAppearanceSettings();
  const { openSidebar, setHideSidebar, isSidebarOpen } = useAppLayout();
  const { loading: workflowsLoading, workflows, selectedWorkflowId: providerSelectedWorkflowId, setSelectedWorkflowId } = useWorkflowSidebar();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;

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
  const isNewConversationDraftRef = useRef<boolean>(false);
  const isInitialMountRef = useRef<boolean>(true);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);

  // Workflow selection (local state for persistence slug calculation)
  const [workflowSelection, setWorkflowSelection] = useState<WorkflowActivation>({ kind: "local", workflow: null });

  // Hosted flow
  const handleHostedFlowDisabled = useCallback(() => {}, []);
  const { mode, setMode, hostedFlowEnabled, disableHostedFlow } = useHostedFlow({ onDisable: handleHostedFlowDisabled });

  // Persistence
  const persistenceSlug = resolvePersistenceSlug(mode, workflowSelection);
  const sessionStorageKey = buildSessionStorageKey(sessionOwner, persistenceSlug);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(() => urlThreadId ?? loadStoredThreadId(sessionOwner, persistenceSlug));

  // Reset chat state hook
  const { resetChatState } = useResetChatState({
    mode,
    sessionOwner,
    workflowSelection,
    refs: { lastThreadSnapshotRef, wasNewConversationStreamingRef, stopVoiceSessionRef },
    setters: { setCurrentThread, setStreamingThreadIds, setIsNewConversationStreaming, setInitialThreadId, setChatInstanceKey },
  });

  // ChatKit session
  const { getClientSecret, reportError, resetError } = useChatkitSession({
    sessionOwner,
    storageKey: sessionStorageKey,
    token,
    mode,
    hostedWorkflowSlug: workflowSelection.kind === "hosted" ? workflowSelection.slug : null,
    disableHostedFlow,
  });

  // Workflow state
  const {
    workflowSelection: managedWorkflowSelection,
    setWorkflowSelection: setManagedWorkflowSelection,
    activeWorkflow,
    activeWorkflowId,
    hostedWorkflowSlug,
    appearanceWorkflowReference,
    handleWorkflowActivated,
  } = useWorkflowState({
    mode,
    setMode,
    workflows,
    providerSelectedWorkflowId,
    setSelectedWorkflowId,
    token,
    isAdmin: user?.is_admin ?? false,
    isNewConversationDraftRef,
    resetChatState,
    resetError,
  });

  // Sync workflow selection
  useEffect(() => { setWorkflowSelection(managedWorkflowSelection); }, [managedWorkflowSelection]);

  // LTI context
  const isLtiUser = user?.is_lti ?? false;
  const { shouldShowLoadingOverlay } = useLtiContext({ isLtiUser, activeWorkflow, workflowsLoading, setHideSidebar });

  // Theme
  const themeConfig = useChatTheme({ appearanceSettings, preferredColorScheme });

  // Appearance workflow sync
  useEffect(() => {
    const desired = appearanceWorkflowReference;
    const current = activeAppearanceWorkflow;
    const isSame = (!desired && !current) ||
      (desired?.kind === "local" && current?.kind === "local" && desired.id === current.id) ||
      (desired?.kind === "hosted" && current?.kind === "hosted" && desired.slug === current.slug);
    if (!isSame) void setAppearanceWorkflow(desired);
  }, [activeAppearanceWorkflow, appearanceWorkflowReference, setAppearanceWorkflow]);

  // URL sync
  const prevUrlThreadIdRef = useRef<string | undefined>(urlThreadId);
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

  // Draft state sync
  useEffect(() => {
    if (!isInitialMountRef.current) isNewConversationDraftRef.current = initialThreadId === null;
  }, [initialThreadId]);

  // Session owner change
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

  // Workflow capabilities
  const { hasVoiceAgent, hasOutboundCall } = useWorkflowCapabilities(token, activeWorkflow?.id ?? null, activeWorkflow?.active_version_id ?? null);

  // Voice session
  const { startVoiceSession, stopVoiceSession, status: voiceStatus, isListening: voiceIsListening, transcripts: voiceTranscripts, interruptSession: interruptVoiceSession, transportError: voiceTransportError } = useWorkflowVoiceSession({
    enabled: hasVoiceAgent,
    threadId: (currentThread?.id as string | undefined) ?? initialThreadId,
    onError: reportError,
    onTranscriptsUpdated: () => requestRefreshRef.current?.("[Voice] Nouvelles transcriptions"),
  });

  // Outbound call
  const handleOutboundTranscript = useCallback(() => requestRefreshRef.current?.("[OutboundCall] Transcription"), []);
  const handleOutboundCallEnd = useCallback(() => requestRefreshRef.current?.("[OutboundCall] Appel terminé"), []);
  const { callId: outboundCallId, isActive: outboundCallIsActive, status: outboundCallStatus, toNumber: outboundCallToNumber, transcripts: outboundCallTranscripts, error: outboundCallError, hangupCall: hangupOutboundCall } = useOutboundCallSession({
    enabled: true, authToken: token, onTranscript: handleOutboundTranscript, onCallEnd: handleOutboundCallEnd,
  });

  useEffect(() => { stopVoiceSessionRef.current = stopVoiceSession; }, [stopVoiceSession]);

  // Sidebar actions
  const { handleSidebarThreadSelect, handleSidebarThreadDeleted, handleNewConversation, handleWorkflowSelectorChange } = useSidebarActions({
    sessionOwner, persistenceSlug, mode, workflowSelection, workflows, currentThread, initialThreadId, token, isAdmin: user?.is_admin ?? false,
    refs: { lastThreadSnapshotRef, wasNewConversationStreamingRef, isNewConversationDraftRef },
    setters: { setCurrentThread, setIsNewConversationStreaming, setInitialThreadId, setChatInstanceKey, setWorkflowSelection: setManagedWorkflowSelection, setSelectedWorkflowId },
  });

  // ChatKit callbacks
  const chatkitCallbacks = useChatkitCallbacks({
    sessionOwner, persistenceSlug,
    refs: { lastThreadSnapshotRef, wasNewConversationStreamingRef, isNewConversationDraftRef, requestRefreshRef },
    setters: { setCurrentThread, setStreamingThreadIds, setIsNewConversationStreaming, setInitialThreadId },
    reportError, resetError,
  });

  // Widgets config
  const widgetsConfig = useChatkitWidgets({
    hasVoiceAgent, hasOutboundCall, threadId: (currentThread?.id as string | undefined) ?? initialThreadId,
    voiceSession: { startVoiceSession, stopVoiceSession, status: voiceStatus, isListening: voiceIsListening, transcripts: voiceTranscripts, interruptSession: interruptVoiceSession, transportError: voiceTransportError },
    outboundCall: { callId: outboundCallId, isActive: outboundCallIsActive, status: outboundCallStatus, toNumber: outboundCallToNumber, transcripts: outboundCallTranscripts, error: outboundCallError, hangupCall: hangupOutboundCall },
  });

  // API config
  const { apiConfig, attachmentsEnabled, debugSnapshot } = useChatApiConfig({ token, hostedFlowEnabled, getClientSecret, missingDomainKeyWarningShownRef });
  const sidebarApiConfig = useMemo(() => token ? { url: debugSnapshot.apiUrl || "/api/chatkit", headers: { Authorization: `Bearer ${token}` } } : null, [token, debugSnapshot.apiUrl]);

  // Attachments config
  const attachmentsConfig = useMemo(() => attachmentsEnabled
    ? { enabled: true, maxCount: 4, maxSize: 10 * 1024 * 1024, accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"], "application/pdf": [".pdf"], "text/plain": [".txt", ".md"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"], "application/msword": [".doc"] } }
    : { enabled: false }, [attachmentsEnabled]);

  const composerPlaceholder = useMemo(() => {
    const candidate = appearanceSettings.start_screen_placeholder?.trim();
    return candidate && candidate.length > 0 ? candidate : "Posez votre question...";
  }, [appearanceSettings.start_screen_placeholder]);

  // Composer models
  const localStorageComposerModels = useMemo(() => loadComposerModelsConfig(), []);
  const workflowForComposer = useMemo(() => activeWorkflow ?? workflows.find((w) => w.is_chatkit_default) ?? (providerSelectedWorkflowId ? workflows.find((w) => w.id === providerSelectedWorkflowId) : null), [activeWorkflow, workflows, providerSelectedWorkflowId]);
  const { composerModels: workflowComposerModels, workflowDetected } = useWorkflowComposerModels({ token, workflowId: workflowForComposer?.id ?? null, activeVersionId: workflowForComposer?.active_version_id ?? null });
  const composerModels = workflowDetected ? workflowComposerModels : localStorageComposerModels;

  // Build ChatKit options
  const chatkitOptions = useMemo(() => {
    const isLtiContextLocal = user?.is_lti ?? false;
    const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiContextLocal;
    return {
      api: apiConfig,
      initialThread: initialThreadId,
      ...(shouldApplyLtiOptions && !activeWorkflow?.lti_show_header ? { header: { enabled: false } } : {
        header: {
          ...(isSidebarOpen ? {} : { leftAction: { icon: "menu" as const, onClick: openSidebar } }),
          ...(mode === "local" && workflows.length > 0 && initialThreadId === null ? { customContent: <WorkflowSelector workflows={workflows} selectedWorkflowId={workflowSelection.kind === "local" ? workflowSelection.workflow?.id ?? null : null} onWorkflowChange={handleWorkflowSelectorChange} /> } : {}),
        },
      }),
      ...(shouldApplyLtiOptions && !activeWorkflow?.lti_enable_history ? { history: { enabled: false } } : {}),
      theme: {
        colorScheme: themeConfig.colorScheme, radius: "pill" as const, density: "normal" as const,
        color: { accent: { primary: appearanceSettings.accent_color, level: 1 }, surface: { background: themeConfig.surface.background, foreground: themeConfig.surface.foreground } },
        typography: { baseSize: 16, fontFamily: appearanceSettings.body_font, fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace' },
      },
      startScreen: themeConfig.greeting || themeConfig.prompts.length > 0 ? { ...(themeConfig.greeting ? { greeting: themeConfig.greeting } : {}), ...(themeConfig.prompts.length > 0 ? { prompts: themeConfig.prompts } : {}) } : undefined,
      disclaimer: themeConfig.disclaimerText ? { text: themeConfig.disclaimerText } : undefined,
      composer: { placeholder: composerPlaceholder, attachments: attachmentsConfig, ...(composerModels ? { models: composerModels } : {}) },
      widgets: widgetsConfig,
      onClientTool: async (toolCall: unknown) => {
        const { name, params } = toolCall as ClientToolCall;
        if (name === "get_weather") {
          const city = params?.city?.trim();
          if (!city) throw new Error("Le paramètre 'city' est requis pour l'outil météo.");
          const searchParams = new URLSearchParams({ city });
          if (params?.country?.trim()) searchParams.set("country", params.country.trim());
          const response = await fetch(`/api/tools/weather?${searchParams.toString()}`);
          if (!response.ok) throw new Error(`Échec de l'appel météo (${response.status})`);
          return response.json();
        }
        throw new Error(`Outil client non pris en charge : ${name}`);
      },
      onError: chatkitCallbacks.onError, onResponseStart: chatkitCallbacks.onResponseStart, onResponseEnd: chatkitCallbacks.onResponseEnd,
      onThreadChange: chatkitCallbacks.onThreadChange, onThreadLoadStart: chatkitCallbacks.onThreadLoadStart, onThreadLoadEnd: chatkitCallbacks.onThreadLoadEnd, onLog: chatkitCallbacks.onLog,
      isAdmin: user?.is_admin,
    } satisfies ChatKitOptions;
  }, [apiConfig, initialThreadId, activeWorkflow, user, isSidebarOpen, openSidebar, mode, workflows, workflowSelection, handleWorkflowSelectorChange, themeConfig, appearanceSettings, composerPlaceholder, attachmentsConfig, composerModels, widgetsConfig, chatkitCallbacks]);

  // Instance cache
  const { currentWorkflowId, activeInstances } = useChatInstanceCache({ mode, activeWorkflowId, hostedWorkflowSlug, activeWorkflow, initialThreadId, chatkitOptions, chatInstanceKey });

  const handleRequestRefreshReady = useCallback((requestRefresh: () => Promise<void>) => { requestRefreshRef.current = requestRefresh; }, []);

  return (
    <>
      <LoadingOverlay isVisible={shouldShowLoadingOverlay} message="Chargement..." variant="fullscreen" />
      <div style={{ display: shouldShowLoadingOverlay ? "none" : "contents" }}>
        <ChatWorkflowSidebar mode={mode} setMode={setMode} onWorkflowActivated={handleWorkflowActivated} api={sidebarApiConfig}
          currentThreadId={initialThreadId === null ? null : ((currentThread?.id as string | undefined) ?? initialThreadId)}
          activeThreadSnapshot={initialThreadId === null ? null : (currentThread as Thread | null)} streamingThreadIds={streamingThreadIds}
          onThreadSelect={handleSidebarThreadSelect} onThreadDeleted={handleSidebarThreadDeleted} onNewConversation={handleNewConversation} hideWorkflows isNewConversationActive={initialThreadId === null} />
        <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            {Array.from(activeInstances.entries()).map(([instanceId, instance]) => (
              <WorkflowChatInstance key={instanceId} workflowId={instanceId} chatkitOptions={instanceId === currentWorkflowId ? chatkitOptions : instance.chatkitOptions}
                token={token} activeWorkflow={instance.workflow} initialThreadId={instanceId === currentWorkflowId ? initialThreadId : instance.initialThreadId}
                reportError={reportError} mode={instance.mode} isActive={instanceId === currentWorkflowId} autoStartEnabled={!hasVoiceAgent}
                onRequestRefreshReady={instanceId === currentWorkflowId ? handleRequestRefreshReady : undefined} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
