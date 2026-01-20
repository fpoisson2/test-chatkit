import { useCallback, useEffect, useMemo, useState, startTransition } from "react";
import { useParams } from "react-router-dom";
import type { ChatKitOptions } from "../../chatkit";
import type { Thread } from "../../chatkit/types";

import { useAuth } from "../../auth";
import { useAppLayout } from "../AppLayout";
import { LoadingOverlay } from "../feedback/LoadingOverlay";
import { WorkflowChatInstance } from "./WorkflowChatInstance";
import { WorkflowSelector } from "./WorkflowSelector";
import { ChatWorkflowSidebar } from "../../features/workflows/WorkflowSidebar";
import { useAppearanceSettings } from "../../features/appearance/AppearanceSettingsContext";
import { usePreferredColorScheme } from "../../hooks/usePreferredColorScheme";
import { useChatkitSession } from "../../hooks/useChatkitSession";
import { useHostedFlow } from "../../hooks/useHostedFlow";
import { useWorkflowVoiceSession } from "../../hooks/useWorkflowVoiceSession";
import { useOutboundCallSession } from "../../hooks/useOutboundCallSession";
import { useWorkflowCapabilities } from "../../hooks/useWorkflowCapabilities";
import { useChatApiConfig } from "../../hooks/useChatApiConfig";
import { useWorkflowSidebar } from "../../features/workflows/WorkflowSidebarProvider";
import { useLtiContext } from "../../hooks/useLtiContext";
import { useChatTheme } from "../../hooks/useChatTheme";
import { useChatkitCallbacks } from "../../hooks/useChatkitCallbacks";
import { useChatInstanceCache } from "../../hooks/useChatInstanceCache";
import { useChatkitWidgets } from "../../hooks/useChatkitWidgets";
import { useResetChatState } from "../../hooks/useResetChatState";
import { useWorkflowState } from "../../hooks/useWorkflowState";
import { useSidebarActions } from "../../hooks/useSidebarActions";
import { useUrlThreadSync } from "../../hooks/useUrlThreadSync";
import { useSessionOwnerSync } from "../../hooks/useSessionOwnerSync";
import { getOrCreateDeviceId } from "../../utils/device";
import { loadComposerModelsConfig } from "../../utils/composerModels";
import { useWorkflowComposerModels } from "../../hooks/useWorkflowComposerModels";
import { loadStoredThreadId } from "../../utils/chatkitThread";
import { resolvePersistenceSlug, buildSessionStorageKey } from "../../utils/chatStorage";
import { useChatContext } from "../../context/ChatContext";

type WeatherToolCall = {
  name: "get_weather";
  params: { city: string; country?: string | null };
};
type ClientToolCall = WeatherToolCall;

export function MyChatContent() {
  const { threadId: urlThreadId } = useParams<{ threadId?: string }>();
  const { token, user } = useAuth();
  const { settings: appearanceSettings, setActiveWorkflow: setAppearanceWorkflow, activeWorkflow: activeAppearanceWorkflow } = useAppearanceSettings();
  const { openSidebar, setHideSidebar, isSidebarOpen } = useAppLayout();
  const { loading: workflowsLoading, workflows, selectedWorkflowId: providerSelectedWorkflowId, setSelectedWorkflowId } = useWorkflowSidebar();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;

  // Get state, setters, and refs from context
  const { state, setters, refs } = useChatContext();
  const {
    currentThread,
    initialThreadId,
    streamingThreadIds,
    chatInstanceKey,
    workflowSelection,
  } = state;
  const { setWorkflowSelection, setInitialThreadId } = setters;
  const {
    isNewConversationDraftRef,
    isInitialMountRef,
    requestRefreshRef,
    stopVoiceSessionRef,
    missingDomainKeyWarningShownRef,
  } = refs;

  // Hosted flow
  const handleHostedFlowDisabled = useCallback(() => {}, []);
  const { mode, setMode, hostedFlowEnabled, disableHostedFlow } = useHostedFlow({ onDisable: handleHostedFlowDisabled });

  // Persistence
  const persistenceSlug = resolvePersistenceSlug(mode, workflowSelection);
  const sessionStorageKey = buildSessionStorageKey(sessionOwner, persistenceSlug);

  // Initialize initialThreadId from URL or storage on mount
  useEffect(() => {
    console.log("[DEBUG-CONV] MyChatContent initialThreadId effect running", {
      urlThreadId,
      sessionOwner,
      persistenceSlug,
      currentInitialThreadId: initialThreadId,
      isInitialMountRef: isInitialMountRef.current,
      isNewConversationDraftRef: isNewConversationDraftRef.current,
      currentPath: window.location.pathname,
      timestamp: new Date().toISOString(),
    });

    // Skip if not initial mount or if we're intentionally in draft mode (new conversation)
    if (!isInitialMountRef.current || isNewConversationDraftRef.current) {
      console.log("[DEBUG-CONV] MyChatContent initialThreadId effect SKIPPED", {
        reason: !isInitialMountRef.current ? "not initial mount" : "new conversation draft mode",
      });
      return;
    }

    // Additional safety: if URL is root path "/" and initialThreadId is already null,
    // don't try to load from storage - we're in new conversation mode
    if (window.location.pathname === "/" && initialThreadId === null) {
      console.log("[DEBUG-CONV] MyChatContent initialThreadId effect SKIPPED (root path + null initialThreadId)");
      return;
    }

    const storedId = urlThreadId ?? loadStoredThreadId(sessionOwner, persistenceSlug);
    console.log("[DEBUG-CONV] MyChatContent storedId resolved", {
      storedId,
      fromUrl: !!urlThreadId,
      fromStorage: !urlThreadId && !!storedId,
    });
    if (storedId && storedId !== initialThreadId) {
      console.log("[DEBUG-CONV] MyChatContent SETTING initialThreadId", { storedId, previousInitialThreadId: initialThreadId });
      // Initial mount - update immediately, don't defer
      setInitialThreadId(storedId);
      // Mark as no longer initial mount only when we actually load a thread
      isInitialMountRef.current = false;
    }
  }, [urlThreadId, sessionOwner, persistenceSlug, initialThreadId, setInitialThreadId, isInitialMountRef, isNewConversationDraftRef]);

  // Reset chat state hook (uses context internally)
  const { resetChatState } = useResetChatState({
    mode,
    sessionOwner,
    workflowSelection,
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
  useEffect(() => {
    // Use startTransition to mark update as non-urgent
    startTransition(() => {
      setWorkflowSelection(managedWorkflowSelection);
    });
  }, [managedWorkflowSelection, setWorkflowSelection]);

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

  // URL thread sync (extracted hook - uses context internally)
  useUrlThreadSync({ urlThreadId, sessionOwner, persistenceSlug });

  // Draft state sync
  useEffect(() => {
    if (!isInitialMountRef.current) isNewConversationDraftRef.current = initialThreadId === null;
  }, [initialThreadId, isInitialMountRef, isNewConversationDraftRef]);

  // Session owner sync (extracted hook - uses context internally)
  useSessionOwnerSync({ sessionOwner, persistenceSlug });

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
  const handleOutboundTranscript = useCallback(() => requestRefreshRef.current?.("[OutboundCall] Transcription"), [requestRefreshRef]);
  const handleOutboundCallEnd = useCallback(() => requestRefreshRef.current?.("[OutboundCall] Appel terminé"), [requestRefreshRef]);
  const { callId: outboundCallId, isActive: outboundCallIsActive, status: outboundCallStatus, toNumber: outboundCallToNumber, transcripts: outboundCallTranscripts, error: outboundCallError, hangupCall: hangupOutboundCall } = useOutboundCallSession({
    enabled: hasOutboundCall, authToken: token, onTranscript: handleOutboundTranscript, onCallEnd: handleOutboundCallEnd,
  });

  useEffect(() => { stopVoiceSessionRef.current = stopVoiceSession; }, [stopVoiceSession, stopVoiceSessionRef]);

  // Sidebar actions (uses context internally)
  const { handleSidebarThreadSelect, handleSidebarThreadDeleted, handleNewConversation, handleWorkflowSelectorChange } = useSidebarActions({
    sessionOwner, persistenceSlug, mode, workflows, token, isAdmin: user?.is_admin ?? false,
    setManagedWorkflowSelection, setSelectedWorkflowId, onWorkflowActivated: handleWorkflowActivated,
  });

  // ChatKit callbacks (uses context internally)
  const chatkitCallbacks = useChatkitCallbacks({
    sessionOwner, persistenceSlug, reportError, resetError, workflowsCount: workflows.length,
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
      onThreadChange: chatkitCallbacks.onThreadChange, onThreadLoadStart: chatkitCallbacks.onThreadLoadStart, onThreadLoadEnd: chatkitCallbacks.onThreadLoadEnd, onThreadNotFound: chatkitCallbacks.onThreadNotFound, onLog: chatkitCallbacks.onLog,
      isAdmin: user?.is_admin,
    } satisfies ChatKitOptions;
  }, [apiConfig, initialThreadId, activeWorkflow, user, isSidebarOpen, openSidebar, mode, workflows, workflowSelection, handleWorkflowSelectorChange, themeConfig, appearanceSettings, composerPlaceholder, attachmentsConfig, composerModels, widgetsConfig, chatkitCallbacks]);

  // Instance cache
  const { currentWorkflowId, activeInstances } = useChatInstanceCache({ mode, activeWorkflowId, hostedWorkflowSlug, activeWorkflow, initialThreadId, chatkitOptions, chatInstanceKey });

  const handleRequestRefreshReady = useCallback((requestRefresh: () => Promise<void>) => { requestRefreshRef.current = requestRefresh; }, [requestRefreshRef]);

  return (
    <>
      <LoadingOverlay isVisible={shouldShowLoadingOverlay} message="Chargement..." variant="fullscreen" />
      <ChatWorkflowSidebar mode={mode} setMode={setMode} onWorkflowActivated={handleWorkflowActivated} api={sidebarApiConfig}
        currentThreadId={initialThreadId === null ? null : ((currentThread?.id as string | undefined) ?? initialThreadId)}
        activeThreadSnapshot={initialThreadId === null ? null : (currentThread as Thread | null)} streamingThreadIds={streamingThreadIds}
        onThreadSelect={handleSidebarThreadSelect} onThreadDeleted={handleSidebarThreadDeleted} onNewConversation={handleNewConversation} hideWorkflows isNewConversationActive={initialThreadId === null} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, width: "100%", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {Array.from(activeInstances.entries()).map(([instanceId, instance]) => (
            <WorkflowChatInstance key={instanceId === currentWorkflowId ? `${instanceId}-${chatInstanceKey}` : instanceId} workflowId={instanceId} chatkitOptions={instanceId === currentWorkflowId ? chatkitOptions : instance.chatkitOptions}
              token={token} activeWorkflow={instance.workflow} initialThreadId={instanceId === currentWorkflowId ? initialThreadId : instance.initialThreadId}
              reportError={reportError} mode={instance.mode} isActive={instanceId === currentWorkflowId} autoStartEnabled={!hasVoiceAgent && (initialThreadId !== null || workflows.length <= 1 || activeWorkflow !== null)}
              onRequestRefreshReady={instanceId === currentWorkflowId ? handleRequestRefreshReady : undefined} />
          ))}
        </div>
      </div>
    </>
  );
}
