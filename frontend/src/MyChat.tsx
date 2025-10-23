import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { ChatKitHost } from "./components/my-chat/ChatKitHost";
import { VoiceSessionBridge, type VoiceSessionDetails } from "./components/my-chat/VoiceSessionBridge";
import { ChatSidebar } from "./components/my-chat/ChatSidebar";
import { ChatStatusMessage } from "./components/my-chat/ChatStatusMessage";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow } from "./hooks/useHostedFlow";
import { useWorkflowChatSession } from "./hooks/useWorkflowChatSession";
import { getOrCreateDeviceId } from "./utils/device";
import { clearStoredChatKitSecret } from "./utils/chatkitSession";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import type { WorkflowSummary } from "./types/workflows";
import { makeApiEndpointCandidates } from "./utils/backend";

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
  workflowSlug?: string | null;
  preserveStoredThread?: boolean;
};

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

const VOICE_WAIT_STATE_METADATA_KEY = "workflow_wait_for_user_input";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizePromptVariables = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};

  Object.entries(value).forEach(([key, raw]) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      return;
    }

    if (typeof raw === "string") {
      result[trimmedKey] = raw;
      return;
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      result[trimmedKey] = String(raw);
    }
  });

  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeToolPermissions = (value: unknown): Record<string, boolean> => {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, boolean> = {};

  Object.entries(value).forEach(([key, raw]) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      return;
    }
    result[trimmedKey] = Boolean(raw);
  });

  return result;
};

const normalizeVoiceSessionConfig = (
  input: unknown,
): VoiceSessionDetails["session"] => {
  if (!isRecord(input)) {
    return {
      model: "",
      voice: "",
      instructions: "",
      prompt_id: null,
      prompt_version: null,
    };
  }

  const model = typeof input.model === "string" ? input.model : "";
  const voice = typeof input.voice === "string" ? input.voice : "";
  const instructions = typeof input.instructions === "string" ? input.instructions : "";
  const promptIdRaw = input.prompt_id;
  const promptVersionRaw = input.prompt_version;
  const prompt_id =
    typeof promptIdRaw === "string" && promptIdRaw.trim() ? promptIdRaw.trim() : null;
  const prompt_version =
    typeof promptVersionRaw === "string" && promptVersionRaw.trim()
      ? promptVersionRaw.trim()
      : null;
  const promptVariables = normalizePromptVariables(input.prompt_variables);

  const result: VoiceSessionDetails["session"] = {
    model,
    voice,
    instructions,
    prompt_id,
    prompt_version,
  };

  if (promptVariables) {
    result.prompt_variables = promptVariables;
  }

  return result;
};

const toRealtimeMode = (value: unknown, fallback: "manual" | "auto"): "manual" | "auto" => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "manual") {
      return normalized;
    }
  }
  return fallback;
};

const normalizeRealtimeConfig = (
  input: unknown,
): VoiceSessionDetails["realtime"] => {
  if (!isRecord(input)) {
    return null;
  }

  const startMode = toRealtimeMode(input.start_mode ?? input.startMode, "manual");
  const stopMode = toRealtimeMode(input.stop_mode ?? input.stopMode, "auto");

  return { startMode, stopMode };
};

const extractVoiceWaitState = (thread: unknown): { slug: string | null } | null => {
  if (!isRecord(thread)) {
    return null;
  }

  const metadata = thread.metadata;
  if (!isRecord(metadata)) {
    return null;
  }

  const waitState = metadata[VOICE_WAIT_STATE_METADATA_KEY];
  if (!isRecord(waitState)) {
    return null;
  }

  const typeValue = waitState.type;
  if (typeof typeValue !== "string" || typeValue.trim().toLowerCase() !== "voice") {
    return null;
  }

  const slugRaw = waitState.slug;
  const slug = typeof slugRaw === "string" && slugRaw.trim() ? slugRaw.trim() : null;

  return { slug };
};

const collectItemsFromContainer = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => isRecord(entry));
  }

  if (isRecord(value)) {
    const result: Record<string, unknown>[] = [];
    const added = value["added"];
    if (Array.isArray(added)) {
      added.forEach((entry) => {
        if (isRecord(entry)) {
          result.push(entry);
        }
      });
    }
    return result;
  }

  return [];
};

const parseVoiceSessionTaskItem = (
  item: Record<string, unknown>,
): VoiceSessionDetails | null => {
  if (item.type !== "task") {
    return null;
  }

  const idRaw = item.id;
  const trimmedId = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!trimmedId) {
    return null;
  }

  const taskId = trimmedId;

  const task = item.task;
  if (!isRecord(task)) {
    return null;
  }

  const content = task.content;
  if (typeof content !== "string") {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isRecord(payload) || payload.type !== "voice_session.created") {
    return null;
  }

  const rawStep = isRecord(payload.step) ? payload.step : undefined;
  const rawSlug = rawStep?.slug;
  const rawTitle = rawStep?.title;

  const stepSlug =
    typeof rawSlug === "string" && rawSlug.trim() ? rawSlug.trim() : null;
  const stepTitle =
    typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : null;

  const session = normalizeVoiceSessionConfig(payload.session);
  const rawSession = isRecord(payload.session) ? payload.session : undefined;
  const fallbackPermissions = rawSession && isRecord(rawSession["realtime"])
    ? (rawSession["realtime"] as Record<string, unknown>)["tools"]
    : undefined;

  const realtimeConfig = normalizeRealtimeConfig(rawSession?.realtime ?? payload.realtime);

  const toolPermissions = normalizeToolPermissions(
    payload.tool_permissions ?? fallbackPermissions,
  );

  return {
    taskId,
    stepSlug,
    stepTitle,
    clientSecret: payload.client_secret,
    session,
    realtime: realtimeConfig,
    toolPermissions,
  };
};

const extractVoiceSessionFromLog = (
  entryName: string,
  data: Record<string, unknown>,
): VoiceSessionDetails | null => {
  const candidates: Record<string, unknown>[] = [];

  if (entryName === "thread.item.added" && isRecord(data.item)) {
    candidates.push(data.item);
  }

  candidates.push(...collectItemsFromContainer(data.items));

  const delta = data.delta;
  if (isRecord(delta)) {
    candidates.push(...collectItemsFromContainer(delta.items));
  }

  for (const candidate of candidates) {
    const voiceSession = parseVoiceSessionTaskItem(candidate);
    if (voiceSession) {
      return voiceSession;
    }
  }

  return null;
};

export function MyChat() {
  const { token, user } = useAuth();
  const { openSidebar } = useAppLayout();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowSummary | null>(null);
  const activeWorkflowSlug = activeWorkflow?.slug ?? null;
  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner, activeWorkflowSlug),
  );
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner, activeWorkflowSlug),
  );
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const [voiceSessionDetails, setVoiceSessionDetails] = useState<VoiceSessionDetails | null>(null);
  const voiceSessionRef = useRef<VoiceSessionDetails | null>(null);
  const processedVoiceTaskIdsRef = useRef<Set<string>>(new Set());
  const activateVoiceSession = useCallback(
    (voiceSession: VoiceSessionDetails) => {
      processedVoiceTaskIdsRef.current.add(voiceSession.taskId);
      voiceSessionRef.current = voiceSession;
      setVoiceSessionDetails(voiceSession);
      console.info("[ChatKit] Voice session created", voiceSession);
    },
    [setVoiceSessionDetails],
  );
  const clearVoiceSessionState = useCallback(() => {
    voiceSessionRef.current = null;
    setVoiceSessionDetails(null);
  }, []);
  const maybeActivateVoiceSessionFromThread = useCallback(
    (thread: Record<string, unknown>) => {
      const waitState = extractVoiceWaitState(thread);
      const activeSlug = waitState?.slug ?? null;
      const candidates = collectItemsFromContainer((thread as { items?: unknown }).items);

      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const voiceSession = parseVoiceSessionTaskItem(candidate);
        if (!voiceSession) {
          continue;
        }
        if (processedVoiceTaskIdsRef.current.has(voiceSession.taskId)) {
          continue;
        }
        if (activeSlug && voiceSession.stepSlug && voiceSession.stepSlug !== activeSlug) {
          continue;
        }
        activateVoiceSession(voiceSession);
        break;
      }
    },
    [activateVoiceSession],
  );
  const resetChatState = useCallback(
    ({ workflowSlug, preserveStoredThread = false }: ResetChatStateOptions = {}) => {
      clearVoiceSessionState();
      processedVoiceTaskIdsRef.current.clear();
      clearStoredChatKitSecret(sessionOwner);

      const resolvedWorkflowSlug = workflowSlug ?? activeWorkflowSlug;
      if (!preserveStoredThread) {
        clearStoredThreadId(sessionOwner, resolvedWorkflowSlug);
      }

      lastThreadSnapshotRef.current = null;

      const nextInitialThreadId = preserveStoredThread
        ? loadStoredThreadId(sessionOwner, resolvedWorkflowSlug)
        : null;
      setInitialThreadId(nextInitialThreadId);
      setChatInstanceKey((value) => value + 1);
    },
    [activeWorkflowSlug, clearVoiceSessionState, sessionOwner],
  );

  const { hostedFlowEnabled, disableHostedFlow } = useHostedFlow({
    onDisable: resetChatState,
  });

  const { getClientSecret, isLoading, error, reportError, resetError } = useChatkitSession({
    sessionOwner,
    token,
    hostedFlowEnabled,
    disableHostedFlow,
  });

  useEffect(() => {
    voiceSessionRef.current = voiceSessionDetails;
  }, [voiceSessionDetails]);

  const handleThreadSnapshotUpdate = useCallback(
    (thread: Record<string, unknown>) => {
      const previousSnapshot = lastThreadSnapshotRef.current;
      lastThreadSnapshotRef.current = thread;

      maybeActivateVoiceSessionFromThread(thread);

      const threadId = typeof thread.id === "string" ? thread.id : null;
      if (threadId) {
        setActiveThreadId((current) => (current === threadId ? current : threadId));
      }

      const activeVoice = voiceSessionRef.current;
      if (!activeVoice) {
        return;
      }

      const previousWait = extractVoiceWaitState(previousSnapshot);
      const currentWait = extractVoiceWaitState(thread);

      const previousMatchesStep =
        previousWait && (!activeVoice.stepSlug || previousWait.slug === activeVoice.stepSlug);

      const slugChanged =
        previousWait &&
        currentWait &&
        previousWait.slug !== currentWait.slug &&
        (!activeVoice.stepSlug || previousWait.slug === activeVoice.stepSlug);

      if (slugChanged) {
        clearVoiceSessionState();
        return;
      }

      if (previousMatchesStep && !currentWait) {
        clearVoiceSessionState();
      }
    },
    [clearVoiceSessionState, maybeActivateVoiceSessionFromThread, setActiveThreadId],
  );

  const handleVoiceTaskLog = useCallback(
    (eventName: string, data: Record<string, unknown>) => {
      const voiceSession = extractVoiceSessionFromLog(eventName, data);
      if (!voiceSession) {
        return;
      }
      if (processedVoiceTaskIdsRef.current.has(voiceSession.taskId)) {
        return;
      }

      activateVoiceSession(voiceSession);
    },
    [activateVoiceSession],
  );

  const handleVoiceSessionReset = useCallback(() => {
    clearVoiceSessionState();
  }, [clearVoiceSessionState]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = preferredColorScheme;
  }, [preferredColorScheme]);

  const handleWorkflowActivated = useCallback(
    (workflow: WorkflowSummary | null, { reason }: { reason: "initial" | "user" }) => {
      setActiveWorkflow((current) => {
        const currentId = current?.id ?? null;
        const nextId = workflow?.id ?? null;

        if (reason === "user" && currentId !== nextId) {
          resetChatState({ workflowSlug: workflow?.slug, preserveStoredThread: true });
          resetError();
        }

        return workflow;
      });
    },
    [resetChatState, resetError],
  );

  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;
    if (previousOwner && previousOwner !== sessionOwner) {
      clearStoredChatKitSecret(previousOwner);
      clearStoredThreadId(previousOwner, activeWorkflowSlug);
      clearVoiceSessionState();
      processedVoiceTaskIdsRef.current.clear();
    }
    previousSessionOwnerRef.current = sessionOwner;

    const storedThreadId = loadStoredThreadId(sessionOwner, activeWorkflowSlug);
    setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
    setActiveThreadId((current) => (current === storedThreadId ? current : storedThreadId));
  }, [activeWorkflowSlug, clearVoiceSessionState, sessionOwner]);

  

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

  const chatkitOptions = useMemo(
    () =>
      ({
        api: apiConfig,
        initialThread: initialThreadId,
        header: {
          leftAction: {
            icon: "menu",
            onClick: openSidebar,
          },
        },
        theme: {
          colorScheme: preferredColorScheme,
          radius: "pill",
          density: "normal",
          typography: {
            baseSize: 16,
            fontFamily:
              '"OpenAI Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
            fontFamilyMono:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
            fontSources: [
              {
                family: "OpenAI Sans",
                src: "https://cdn.openai.com/common/fonts/openai-sans/v2/OpenAISans-Regular.woff2",
                weight: 400,
                style: "normal",
                display: "swap",
              },
              // ...and 7 more font sources
            ],
          },
        },
        composer: {
          placeholder: "Posez votre question...",
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
          if (threadId) {
            persistStoredThreadId(sessionOwner, threadId, activeWorkflowSlug);
          } else {
            clearStoredThreadId(sessionOwner, activeWorkflowSlug);
          }
          setInitialThreadId((current) => (current === threadId ? current : threadId));
          setActiveThreadId(threadId);
        },
        onThreadLoadStart: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load start", { threadId });
        },
        onThreadLoadEnd: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load end", { threadId });
          setActiveThreadId((current) => (current === threadId ? current : threadId));
        },
        onLog: (entry: { name: string; data?: Record<string, unknown> }) => {
          if (entry?.data && typeof entry.data === "object") {
            const data = entry.data as Record<string, unknown>;
            const threadCandidate = data.thread;
            if (isRecord(threadCandidate)) {
              handleThreadSnapshotUpdate(threadCandidate);
            } else if (threadCandidate) {
              lastThreadSnapshotRef.current = threadCandidate as Record<string, unknown>;
            }
            handleVoiceTaskLog(entry.name, data);
          }
          console.debug("[ChatKit] log", entry.name, entry.data ?? {});
        },
      }) satisfies ChatKitOptions,
    [
      apiConfig,
      attachmentsConfig,
      initialThreadId,
      openSidebar,
      sessionOwner,
      activeWorkflow?.id,
      activeWorkflowSlug,
      chatInstanceKey,
      preferredColorScheme,
      reportError,
      handleThreadSnapshotUpdate,
      handleVoiceTaskLog,
    ],
  );

  const { control, requestRefresh, sendCustomAction } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow,
    initialThreadId,
    reportError,
  });

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
    return () => {
      requestRefreshRef.current = null;
    };
  }, [requestRefresh]);

  const statusMessage = error ?? (isLoading ? "Initialisation de la session…" : null);

  return (
    <>
      <ChatSidebar onWorkflowActivated={handleWorkflowActivated} />
      <ChatKitHost control={control} chatInstanceKey={chatInstanceKey} />
      {voiceSessionDetails && (
        <VoiceSessionBridge
          details={voiceSessionDetails}
          onReset={handleVoiceSessionReset}
          threadId={activeThreadId}
          sendCustomAction={sendCustomAction}
        />
      )}
      <ChatStatusMessage message={statusMessage} isError={Boolean(error)} isLoading={isLoading} />
    </>
  );
}
