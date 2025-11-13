import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatKitOptions, StartScreenPrompt } from "@openai/chatkit";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { LoadingOverlay } from "./components/feedback/LoadingOverlay";
import { WorkflowChatInstance } from "./components/my-chat/WorkflowChatInstance";
import { ChatSidebar, type WorkflowActivation } from "./components/my-chat/ChatSidebar";
import { ChatStatusMessage } from "./components/my-chat/ChatStatusMessage";
import { OutboundCallAudioPlayer } from "./components/my-chat/OutboundCallAudioPlayer";
import {
  useAppearanceSettings,
  type AppearanceWorkflowReference,
} from "./features/appearance/AppearanceSettingsContext";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow, type HostedFlowMode } from "./hooks/useHostedFlow";
import { useWorkflowVoiceSession } from "./hooks/useWorkflowVoiceSession";
import { useOutboundCallSession } from "./hooks/useOutboundCallSession";
import { useChatApiConfig } from "./hooks/useChatApiConfig";
import { useWorkflowSidebar } from "./features/workflows/WorkflowSidebarProvider";
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
  const { loading: workflowsLoading, workflows } = useWorkflowSidebar();
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
  const [chatInstanceKey, setChatInstanceKey] = useState(0);

  // Keep track of active workflow instances to preserve state
  type WorkflowInstanceData = {
    workflowId: string;
    mode: HostedFlowMode;
    initialThreadId: string | null;
    chatkitOptions: ChatKitOptions;
    createdAt: number;
  };
  const [activeInstances, setActiveInstances] = useState<Map<string, WorkflowInstanceData>>(
    new Map()
  );
  const MAX_CACHED_INSTANCES = 5;

  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const [currentThread, setCurrentThread] = useState<Record<string, unknown> | null>(null);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const stopVoiceSessionRef = useRef<(() => void) | null>(null);
  const resetChatStateRef = useRef<((options?: ResetChatStateOptions) => void) | null>(null);

  useEffect(() => {
    latestWorkflowSelectionRef.current = workflowSelection;
  }, [workflowSelection]);

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

  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner, persistenceSlug),
  );

  const resetChatState = useCallback(
    ({
      selection,
      preserveStoredThread = false,
      targetMode,
    }: ResetChatStateOptions = {}) => {
      const effectiveMode = targetMode ?? mode;
      const effectiveSelection = selection ?? workflowSelection;
      const resolvedSlug = resolvePersistenceSlug(effectiveMode, effectiveSelection);
      const storageKey = buildSessionStorageKey(sessionOwner, resolvedSlug);

      clearStoredChatKitSecret(storageKey);

      if (!preserveStoredThread) {
        clearStoredThreadId(sessionOwner, resolvedSlug);
      }

      lastThreadSnapshotRef.current = null;

      const nextInitialThreadId = preserveStoredThread
        ? loadStoredThreadId(sessionOwner, resolvedSlug)
        : null;
      setInitialThreadId(nextInitialThreadId);
      setChatInstanceKey((value) => value + 1);

      // Arrêter la session vocale si elle est en cours
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

  const { getClientSecret, isLoading, error, reportError, resetError } = useChatkitSession({
    sessionOwner,
    storageKey: sessionStorageKey,
    token,
    mode,
    hostedWorkflowSlug: workflowSelection.kind === "hosted" ? workflowSelection.slug : null,
    disableHostedFlow,
  });

  const { stopVoiceSession, status: voiceStatus, isListening: voiceIsListening } = useWorkflowVoiceSession({
    threadId: initialThreadId,
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
      clearStoredChatKitSecret(buildSessionStorageKey(previousOwner, "hosted"));
      clearStoredThreadId(previousOwner, "hosted");
      clearStoredChatKitSecret(buildSessionStorageKey(previousOwner, persistenceSlug));
      clearStoredThreadId(previousOwner, persistenceSlug);
    }
    previousSessionOwnerRef.current = sessionOwner;

    const storedThreadId = loadStoredThreadId(sessionOwner, persistenceSlug);
    setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
  }, [persistenceSlug, sessionOwner]);

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

  const chatkitOptions = useMemo(
    () => {
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

      // Detect LTI context
      const isLtiContext = user?.email.endsWith('@lti.local') ?? false;
      // Apply LTI options only in LTI context
      const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiContext;

      return {
        api: apiConfig,
        initialThread: initialThreadId,
        ...(shouldApplyLtiOptions && !activeWorkflow?.lti_show_header ? {
          header: { enabled: false },
        } : {
          header: {
            leftAction: {
              icon: "menu",
              onClick: openSidebar,
            },
          },
        }),
        ...(shouldApplyLtiOptions && !activeWorkflow?.lti_enable_history ? {
          history: { enabled: false },
        } : {}),
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
                throw new Error("Le paramètre 'city' est requis pour l'outil météo.");
              }

              const searchParams = new URLSearchParams({ city });
              if (country) {
                searchParams.set("country", country);
              }

              const response = await fetch(`/api/tools/weather?${searchParams.toString()}`);
              if (!response.ok) {
                const details = await response.text();
                throw new Error(
                  `Échec de l'appel météo (${response.status}) : ${details || "réponse vide"}`,
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
          requestRefreshRef.current?.("[ChatKit] Échec de la synchronisation après la réponse");
        },
        onThreadChange: ({ threadId }: { threadId: string | null }) => {
          console.debug("[ChatKit] thread change", { threadId });
          persistStoredThreadId(sessionOwner, threadId, persistenceSlug);
          setInitialThreadId((current) => (current === threadId ? current : threadId));
        },
        onThreadLoadStart: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load start", { threadId });
        },
        onThreadLoadEnd: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load end", { threadId });
        },
        onLog: (entry: { name: string; data?: Record<string, unknown> }) => {
          // Debug: Log every onLog call
          console.log('[MyChat] onLog called:', entry.name, {
            hasData: !!entry.data,
            dataKeys: entry.data ? Object.keys(entry.data) : [],
          });

          if (entry?.data && typeof entry.data === "object") {
            const data = entry.data as Record<string, unknown>;
            if ("thread" in data && data.thread) {
              const thread = data.thread as Record<string, unknown>;
              lastThreadSnapshotRef.current = thread;
              // Update state to trigger re-render and useOutboundCallDetector
              setCurrentThread(thread);

              // Debug: Log thread structure
              console.log('[MyChat] Thread updated:', {
                keys: Object.keys(thread),
                hasItems: 'items' in thread,
                hasMessages: 'messages' in thread,
                itemsLength: Array.isArray(thread.items) ? thread.items.length : 'N/A',
                messagesLength: Array.isArray(thread.messages) ? thread.messages.length : 'N/A',
                firstItem: Array.isArray(thread.items) && thread.items.length > 0 ? thread.items[0] : null,
              });
            }
          }
          console.debug("[ChatKit] log", entry.name, entry.data ?? {});
        },
      } satisfies ChatKitOptions;
    },
    [
      appearanceSettings,
      apiConfig,
      attachmentsConfig,
      composerPlaceholder,
      initialThreadId,
      openSidebar,
      preferredColorScheme,
      sessionOwner,
      activeWorkflow?.id,
      activeWorkflow?.lti_enabled,
      activeWorkflow?.lti_show_sidebar,
      activeWorkflow?.lti_show_header,
      activeWorkflow?.lti_enable_history,
      activeWorkflowSlug,
      persistenceSlug,
      reportError,
      user?.email,
    ],
  );

  // Generate unique ID for current workflow
  const currentWorkflowId = useMemo(() => {
    if (mode === "hosted") {
      return `hosted::${hostedWorkflowSlug ?? "__default__"}`;
    }
    return `local::${activeWorkflowId ?? "__default__"}`;
  }, [mode, hostedWorkflowSlug, activeWorkflowId]);

  // Update or create instance for current workflow
  useEffect(() => {
    setActiveInstances((prev) => {
      const existing = prev.get(currentWorkflowId);

      // If instance already exists, don't recreate it - this preserves its state
      if (existing) {
        return prev;
      }

      const next = new Map(prev);

      // Add new instance only if it doesn't exist
      next.set(currentWorkflowId, {
        workflowId: currentWorkflowId,
        mode,
        initialThreadId,
        chatkitOptions,
        createdAt: Date.now(),
      });

      // Limit cache size - remove oldest instances
      if (next.size > MAX_CACHED_INSTANCES) {
        const entries = Array.from(next.entries());
        entries.sort((a, b) => a[1].createdAt - b[1].createdAt);

        // Keep current and most recent instances
        const toKeep = entries
          .filter(([id]) => id === currentWorkflowId)
          .concat(entries.filter(([id]) => id !== currentWorkflowId).slice(-MAX_CACHED_INSTANCES + 1));

        return new Map(toKeep);
      }

      return next;
    });
  }, [currentWorkflowId, mode, initialThreadId, chatkitOptions, MAX_CACHED_INSTANCES]);

  const handleRequestRefreshReady = useCallback((requestRefresh: () => Promise<void>) => {
    requestRefreshRef.current = requestRefresh;
  }, []);

  const voiceStatusMessage = voiceStatus === "connected"
    ? `Session vocale active${voiceIsListening ? " - En écoute" : ""}`
    : voiceStatus === "connecting"
    ? "Connexion audio en cours..."
    : null;

  // Detect LTI user
  const isLtiUser = user?.email.endsWith('@lti.local') ?? false;

  // Hide sidebar immediately for LTI users on initial load
  useEffect(() => {
    if (isLtiUser && !activeWorkflow) {
      setHideSidebar(true);
    }
  }, [isLtiUser, activeWorkflow, setHideSidebar]);

  // Apply LTI sidebar visibility setting
  useEffect(() => {
    const shouldApplyLtiOptions = activeWorkflow?.lti_enabled && isLtiUser;
    const shouldHideSidebar = shouldApplyLtiOptions && !activeWorkflow?.lti_show_sidebar;

    setHideSidebar(shouldHideSidebar);

    // Cleanup: restore sidebar when unmounting or when conditions change
    return () => {
      setHideSidebar(false);
    };
  }, [activeWorkflow?.lti_enabled, activeWorkflow?.lti_show_sidebar, isLtiUser, setHideSidebar]);

  // Show loading overlay for LTI users until workflow is ready and chat instance is created
  const hasActiveInstance = activeInstances.has(currentWorkflowId);
  const shouldShowLoadingOverlay = isLtiUser && (!activeWorkflow || workflowsLoading || !hasActiveInstance);

  return (
    <>
      <LoadingOverlay
        isVisible={shouldShowLoadingOverlay}
        message="Chargement de votre espace de travail..."
      />
      <div style={{ display: isLtiUser ? 'none' : 'contents' }}>
        <ChatSidebar
          mode={mode}
          setMode={setMode}
          onWorkflowActivated={handleWorkflowActivated}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
        {Array.from(activeInstances.entries()).map(([instanceId, instance]) => (
          <WorkflowChatInstance
            key={instanceId}
            workflowId={instanceId}
            chatkitOptions={instance.chatkitOptions}
            token={token}
            activeWorkflow={activeWorkflow}
            initialThreadId={instance.initialThreadId}
            reportError={reportError}
            mode={instance.mode}
            isActive={instanceId === currentWorkflowId}
            onRequestRefreshReady={
              instanceId === currentWorkflowId ? handleRequestRefreshReady : undefined
            }
          />
        ))}
      </div>
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
