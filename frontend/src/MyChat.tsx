import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatKitOptions, StartScreenPrompt } from "@openai/chatkit";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { ChatKitHost } from "./components/my-chat/ChatKitHost";
import { ChatSidebar, type WorkflowActivation } from "./components/my-chat/ChatSidebar";
import { ChatStatusMessage } from "./components/my-chat/ChatStatusMessage";
import {
  useAppearanceSettings,
  type AppearanceWorkflowReference,
} from "./features/appearance/AppearanceSettingsContext";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow, type HostedFlowMode } from "./hooks/useHostedFlow";
import { useWorkflowChatSession } from "./hooks/useWorkflowChatSession";
import { useWorkflowVoiceSession } from "./hooks/useWorkflowVoiceSession";
import { getOrCreateDeviceId } from "./utils/device";
import { clearStoredChatKitSecret } from "./utils/chatkitSession";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import type { WorkflowSummary } from "./types/workflows";
import { makeApiEndpointCandidates } from "./utils/backend";
import type { AppearanceSettings } from "./utils/backend";

type ChatConfigDebugSnapshot = {
  hostedFlow: boolean;
  apiUrl: string;
  backendCandidates: string[];
  attachments: "two_phase" | "direct" | "disabled";
  skipDomainVerification: boolean;
  domainKeySource: "custom" | "dev" | "none";
};

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

type SecureUrlNormalizationResult =
  | { kind: "ok"; url: string; wasUpgraded: boolean }
  | { kind: "error"; message: string };

const ensureSecureUrl = (rawUrl: string): SecureUrlNormalizationResult => {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return {
      kind: "error",
      message: "[ChatKit] URL vide détectée.",
    };
  }

  if (typeof window === "undefined") {
    return { kind: "ok", url: trimmed, wasUpgraded: false };
  }

  const isProtocolRelative = trimmed.startsWith("//");
  const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) || isProtocolRelative;

  if (!isAbsolute) {
    return { kind: "ok", url: trimmed, wasUpgraded: false };
  }

  let parsed: URL;

  try {
    parsed = new URL(isProtocolRelative ? `${window.location.protocol}${trimmed}` : trimmed);
  } catch (error) {
    return {
      kind: "error",
      message: `[ChatKit] URL invalide détectée (${trimmed}).`,
    };
  }

  const { protocol: pageProtocol, hostname: pageHostname } = window.location;

  if (pageProtocol === "https:" && parsed.protocol === "http:") {
    if (parsed.hostname === pageHostname) {
      parsed.protocol = "https:";
      return { kind: "ok", url: parsed.toString(), wasUpgraded: true };
    }

    return {
      kind: "error",
      message:
        `[ChatKit] URL non sécurisée (${trimmed}) détectée en contexte HTTPS. Utilisez HTTPS ou une URL relative pour éviter le contenu mixte.`,
    };
  }

  return { kind: "ok", url: parsed.toString(), wasUpgraded: false };
};

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
  const { openSidebar } = useAppLayout();
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
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const stopVoiceSessionRef = useRef<(() => void) | null>(null);
  const resetChatStateRef = useRef<((options?: ResetChatStateOptions) => void) | null>(null);

  useEffect(() => {
    latestWorkflowSelectionRef.current = workflowSelection;
  }, [workflowSelection]);

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

        if (reason === "user" && currentId !== nextId) {
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

  

  const { apiConfig, attachmentsEnabled, debugSnapshot } = useMemo<{
    apiConfig: ChatKitOptions["api"];
    attachmentsEnabled: boolean;
    debugSnapshot: ChatConfigDebugSnapshot;
  }>(() => {
    const forceHosted = hostedFlowEnabled;

    const rawDomainKey = import.meta.env.VITE_CHATKIT_DOMAIN_KEY?.trim();
    const skipDomainVerification =
      import.meta.env.VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION?.trim().toLowerCase() ===
      "true";
    const shouldBypassDomainCheck = skipDomainVerification || !rawDomainKey;
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";

    let domainKeySource: ChatConfigDebugSnapshot["domainKeySource"] = "none";
    const domainKey = (() => {
      if (rawDomainKey) {
        domainKeySource = "custom";
        return rawDomainKey;
      }
      if (isLocalHost) {
        domainKeySource = "dev";
        return "domain_pk_localhost_dev";
      }
      domainKeySource = "none";
      return undefined;
    })();

    if (!rawDomainKey && !isLocalHost && !missingDomainKeyWarningShownRef.current) {
      console.warn(
        "[ChatKit] Domaine personnalisé '%s' détecté sans VITE_CHATKIT_DOMAIN_KEY. Ajoutez la clé fournie par la console OpenAI pour éviter la désactivation du widget.",
        host || "inconnu",
      );
      missingDomainKeyWarningShownRef.current = true;
    }

    const explicitCustomUrl = import.meta.env.VITE_CHATKIT_API_URL?.trim();
    const backendUrl = import.meta.env.VITE_BACKEND_URL?.trim() ?? "";
    const endpointCandidates = makeApiEndpointCandidates(backendUrl, "/api/chatkit");
    const [defaultRelativeUrl] = endpointCandidates;
    const customApiUrl = explicitCustomUrl || defaultRelativeUrl || "/api/chatkit";
    const useHostedFlow = forceHosted;

    if (useHostedFlow) {
      return {
        apiConfig: { getClientSecret },
        attachmentsEnabled: true,
        debugSnapshot: {
          hostedFlow: true,
          apiUrl: "/api/chatkit/session",
          backendCandidates: endpointCandidates,
          attachments: "two_phase",
          skipDomainVerification: shouldBypassDomainCheck,
          domainKeySource,
        },
      };
    }

    const normalizedStrategy = import.meta.env.VITE_CHATKIT_UPLOAD_STRATEGY
      ?.trim()
      .toLowerCase();

    let attachmentsAreEnabled = false;
    let uploadStrategy:
      | { type: "two_phase" }
      | { type: "direct"; uploadUrl: string }
      | undefined;

    if (!normalizedStrategy) {
      if (explicitCustomUrl) {
        console.warn(
          "[ChatKit] VITE_CHATKIT_API_URL détecté sans VITE_CHATKIT_UPLOAD_STRATEGY : les pièces jointes seront désactivées.",
        );
      }
    } else if (normalizedStrategy === "two_phase" || normalizedStrategy === "two-phase") {
      uploadStrategy = { type: "two_phase" };
      attachmentsAreEnabled = true;
    } else if (normalizedStrategy === "direct") {
      const directUploadUrl = import.meta.env.VITE_CHATKIT_DIRECT_UPLOAD_URL?.trim();
      if (directUploadUrl) {
        const normalizedDirectUpload = ensureSecureUrl(directUploadUrl);

        if (normalizedDirectUpload.kind === "ok") {
          if (normalizedDirectUpload.wasUpgraded) {
            console.info(
              "[ChatKit] URL de téléchargement directe mise à niveau vers HTTPS pour éviter le contenu mixte.",
            );
          }

          uploadStrategy = { type: "direct", uploadUrl: normalizedDirectUpload.url };
          attachmentsAreEnabled = true;
        } else {
          console.warn(`${normalizedDirectUpload.message} Les pièces jointes restent désactivées.`);
        }
      } else {
        console.warn(
          "[ChatKit] VITE_CHATKIT_UPLOAD_STRATEGY=direct nécessite VITE_CHATKIT_DIRECT_UPLOAD_URL. Les pièces jointes restent désactivées.",
        );
      }
    } else {
      console.warn(
        `[ChatKit] Stratégie d'upload inconnue : "${normalizedStrategy}". Les pièces jointes restent désactivées.`,
      );
    }

    const resolveResourceUrl = (resource: Parameters<typeof fetch>[0]): string | null => {
      if (typeof resource === "string") {
        return resource;
      }
      if (typeof URL !== "undefined" && resource instanceof URL) {
        return resource.href;
      }
      if (resource && typeof resource === "object" && "url" in resource) {
        const { url } = resource as { url?: string };
        return typeof url === "string" ? url : null;
      }
      return null;
    };

    const normalizeFetchResource = (
      resource: Parameters<typeof fetch>[0],
    ):
      | {
          kind: "ok";
          resource: Parameters<typeof fetch>[0];
          wasUpgraded: boolean;
          originalUrl: string | null;
          normalizedUrl: string | null;
        }
      | { kind: "error"; message: string } => {
      const url = resolveResourceUrl(resource);
      if (!url) {
        return { kind: "ok", resource, wasUpgraded: false, originalUrl: null, normalizedUrl: null };
      }

      const normalized = ensureSecureUrl(url);

      if (normalized.kind === "error") {
        return normalized;
      }

      if (normalized.url === url) {
        return {
          kind: "ok",
          resource,
          wasUpgraded: normalized.wasUpgraded,
          originalUrl: url,
          normalizedUrl: normalized.url,
        };
      }

      if (typeof resource === "string") {
        return {
          kind: "ok",
          resource: normalized.url,
          wasUpgraded: normalized.wasUpgraded,
          originalUrl: url,
          normalizedUrl: normalized.url,
        };
      }

      if (typeof URL !== "undefined" && resource instanceof URL) {
        return {
          kind: "ok",
          resource: normalized.url,
          wasUpgraded: normalized.wasUpgraded,
          originalUrl: url,
          normalizedUrl: normalized.url,
        };
      }

      if (typeof Request !== "undefined" && resource instanceof Request) {
        const clonedRequest = new Request(normalized.url, resource);
        return {
          kind: "ok",
          resource: clonedRequest,
          wasUpgraded: normalized.wasUpgraded,
          originalUrl: url,
          normalizedUrl: normalized.url,
        };
      }

      return {
        kind: "ok",
        resource: normalized.url,
        wasUpgraded: normalized.wasUpgraded,
        originalUrl: url,
        normalizedUrl: normalized.url,
      };
    };

    const buildServerErrorMessage = (
      url: string | null,
      status: number,
      statusText: string,
      details: string | null,
    ) => {
      const baseUrl = url ?? "l'endpoint ChatKit";
      const normalizedText = statusText || "Erreur serveur";
      const mainMessage = `Le serveur ChatKit (${baseUrl}) a renvoyé ${status} ${normalizedText}.`;

      const hint =
        status === 502
          ? " Vérifiez que votre implémentation auto-hébergée est accessible et que la variable VITE_CHATKIT_API_URL pointe vers la bonne URL."
          : "";

      const extraDetails = details ? ` Détails : ${details}` : "";

      return `${mainMessage}${hint}${extraDetails}`.trim();
    };

    const authFetch: typeof fetch = async (resource, init) => {
      const headers = new Headers(init?.headers ?? {});
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const normalizedResource = normalizeFetchResource(resource);

      if (normalizedResource.kind === "error") {
        const message = `${normalizedResource.message} Cette requête a été bloquée pour éviter le contenu mixte.`;
        console.warn(message);
        throw new Error(message);
      }

      const {
        resource: safeResource,
        wasUpgraded,
        originalUrl,
        normalizedUrl,
      } = normalizedResource;

      const targetUrl = normalizedUrl ?? resolveResourceUrl(safeResource);
      const isDomainVerificationRequest =
        typeof targetUrl === "string" && targetUrl.includes("/domain_keys/verify");

      if (
        wasUpgraded &&
        originalUrl &&
        normalizedUrl &&
        originalUrl !== normalizedUrl
      ) {
        console.info(
          "[ChatKit] URL HTTP mise à niveau vers HTTPS pour éviter le contenu mixte.",
          { initialUrl: originalUrl, upgradedUrl: normalizedUrl },
        );
      }

      if (shouldBypassDomainCheck && targetUrl?.includes("/domain_keys/verify")) {
        console.info("[ChatKit] Vérification de domaine ignorée (mode développement).");
        return new Response(
          JSON.stringify({ status: "skipped" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      try {
        const response = await fetch(safeResource, {
          ...init,
          headers,
        });

        if (
          isDomainVerificationRequest &&
          !response.ok &&
          (response.status === 404 || response.status === 405 || response.status === 501)
        ) {
          if (import.meta.env.DEV) {
            console.info(
              "[ChatKit] Endpoint de vérification de domaine indisponible. Passage en mode ignoré.",
            );
          }

          return new Response(JSON.stringify({ status: "skipped" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!response.ok) {
          let responseDetails: string | null = null;
          try {
            responseDetails = await response.clone().text();
          } catch (cloneError) {
            if (import.meta.env.DEV) {
              console.warn("[ChatKit] Impossible de lire le corps de la réponse d'erreur", cloneError);
            }
          }

          const errorMessage = buildServerErrorMessage(
            targetUrl,
            response.status,
            response.statusText,
            responseDetails?.trim() ? responseDetails : null,
          );

          const enhancedError = new Error(errorMessage);
          (enhancedError as Error & { response?: Response }).response = response;
          throw enhancedError;
        }

        return response;
      } catch (err) {
        if (err instanceof TypeError) {
          if (isDomainVerificationRequest) {
            if (import.meta.env.DEV) {
              console.warn(
                "[ChatKit] Impossible de joindre l'endpoint de vérification de domaine. Passage en mode ignoré.",
                err,
              );
            }

            return new Response(JSON.stringify({ status: "skipped" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          const connectivityMessage = targetUrl
            ? `Impossible de contacter ${targetUrl}. Vérifiez votre connexion réseau ou la disponibilité du serveur ChatKit.`
            : "Impossible de joindre le serveur ChatKit. Vérifiez votre connexion réseau.";
          throw new Error(connectivityMessage, { cause: err });
        }

        throw err;
      }
    };

    const customApiConfig = uploadStrategy
      ? ({
          url: customApiUrl,
          fetch: authFetch,
          uploadStrategy,
          ...(domainKey ? { domainKey } : {}),
        } as ChatKitOptions["api"])
      : ({
          url: customApiUrl,
          fetch: authFetch,
          ...(domainKey ? { domainKey } : {}),
        } as ChatKitOptions["api"]);

    return {
      apiConfig: customApiConfig,
      attachmentsEnabled: attachmentsAreEnabled,
      debugSnapshot: {
        hostedFlow: false,
        apiUrl: customApiUrl,
        backendCandidates: endpointCandidates,
        attachments: uploadStrategy?.type ?? "disabled",
        skipDomainVerification: shouldBypassDomainCheck,
        domainKeySource,
      },
    };
  }, [
    getClientSecret,
    hostedFlowEnabled,
    missingDomainKeyWarningShownRef,
    token,
  ]);

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

      return {
        api: apiConfig,
        initialThread: initialThreadId,
        header: {
          leftAction: {
            icon: "menu",
            onClick: openSidebar,
          },
        },
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
          if (entry?.data && typeof entry.data === "object") {
            const data = entry.data as Record<string, unknown>;
            if ("thread" in data && data.thread) {
              lastThreadSnapshotRef.current = data.thread as Record<string, unknown>;
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
      activeWorkflowSlug,
      persistenceSlug,
      reportError,
    ],
  );

  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow,
    initialThreadId,
    reportError,
    mode,
  });

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
    return () => {
      requestRefreshRef.current = null;
    };
  }, [requestRefresh]);

  const hasActiveThread = Boolean(control.threadId);
  const introMessage =
    !error && !isLoading && !hasActiveThread
      ? [
          appearanceSettings.start_screen_greeting,
          appearanceSettings.start_screen_prompt,
          appearanceSettings.start_screen_disclaimer,
        ]
          .map((part) => part?.trim())
          .filter((part): part is string => Boolean(part && part.length > 0))
          .join("\n\n") || null
      : null;

  const statusMessage =
    error ?? (isLoading ? "Initialisation de la session…" : introMessage);

  const voiceStatusMessage = voiceStatus === "connected"
    ? `Session vocale active${voiceIsListening ? " - En écoute" : ""}`
    : voiceStatus === "connecting"
    ? "Connexion audio en cours..."
    : null;

  return (
    <>
      <ChatSidebar mode={mode} setMode={setMode} onWorkflowActivated={handleWorkflowActivated} />
      <ChatKitHost control={control} chatInstanceKey={chatInstanceKey} />
      <ChatStatusMessage message={statusMessage} isError={Boolean(error)} isLoading={isLoading} />
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
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </>
  );
}
