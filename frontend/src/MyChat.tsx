import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { ChatKitHost } from "./components/my-chat/ChatKitHost";
import { ChatSidebar } from "./components/my-chat/ChatSidebar";
import { ChatStatusMessage } from "./components/my-chat/ChatStatusMessage";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow } from "./hooks/useHostedFlow";
import { useWorkflowChatSession } from "./hooks/useWorkflowChatSession";
import {
  useWorkflowVoiceSession,
  type UseWorkflowVoiceSessionOptions,
  type WorkflowVoiceSessionBackendResponse,
} from "./hooks/useWorkflowVoiceSession";
import { useI18n } from "./i18n";
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

export function MyChat() {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const { openSidebar } = useAppLayout();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowSummary | null>(null);
  const activeWorkflowSlug = activeWorkflow?.slug ?? null;
  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner, activeWorkflowSlug),
  );
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(initialThreadId);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const backendUrl = import.meta.env.VITE_BACKEND_URL?.trim() ?? "";
  const resetChatState = useCallback(
    ({ workflowSlug, preserveStoredThread = false }: ResetChatStateOptions = {}) => {
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
      setCurrentThreadId(nextInitialThreadId);
      setChatInstanceKey((value) => value + 1);
    },
    [activeWorkflowSlug, sessionOwner],
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

  const workflowVoice = useWorkflowVoiceSession({
    resolveSession: resolveWorkflowVoiceSession,
  });
  const {
    handleLogEvent: handleVoiceLogEvent,
    stopSession: stopWorkflowVoiceSession,
    status: voiceStatus,
    error: voiceError,
    isRequestingMic: voiceIsRequestingMic,
    activeStepSlug: voiceStepSlug,
    activeStepTitle: voiceStepTitle,
    transcripts: voiceTranscripts,
  } = workflowVoice;

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
    }
    previousSessionOwnerRef.current = sessionOwner;

    const storedThreadId = loadStoredThreadId(sessionOwner, activeWorkflowSlug);
    setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
    setCurrentThreadId((current) => (current === storedThreadId ? current : storedThreadId));
  }, [activeWorkflowSlug, sessionOwner]);

  useEffect(() => {
    stopWorkflowVoiceSession();
    setCurrentThreadId(initialThreadId);
  }, [activeWorkflow?.id, initialThreadId, stopWorkflowVoiceSession]);

  useEffect(() => {
    if (voiceTranscripts.length > 0) {
      console.debug("[Voice] transcripts", voiceTranscripts);
    }
  }, [voiceTranscripts]);

  

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

  const resolveWorkflowVoiceSession = useCallback(
    async ({
      payload: _payload,
      metadataSlug: _metadataSlug,
      metadataTitle: _metadataTitle,
    }: Parameters<
      NonNullable<UseWorkflowVoiceSessionOptions["resolveSession"]>
    >[0]): Promise<WorkflowVoiceSessionBackendResponse | null> => {
      if (!token) {
        throw new Error(
          "Authentification requise pour démarrer la session vocale du workflow.",
        );
      }
      if (!currentThreadId) {
        throw new Error(
          "Aucun fil de conversation actif pour la session vocale du workflow.",
        );
      }

      const encodedThreadId = encodeURIComponent(currentThreadId);
      const candidates = makeApiEndpointCandidates(
        backendUrl,
        `/api/chatkit/workflows/${encodedThreadId}/voice/session`,
      );

      let lastError: Error | null = null;
      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            const message = detail.trim()
              ? `${response.status} ${response.statusText} – ${detail.trim()}`
              : `${response.status} ${response.statusText}`;
            const error = new Error(
              `Échec de la récupération de la session vocale (${message}).`,
            );
            if (candidate.startsWith("/") && candidates.length > 1) {
              lastError = error;
              continue;
            }
            throw error;
          }

          const data = (await response.json()) as WorkflowVoiceSessionBackendResponse;
          return data;
        } catch (error) {
          const normalized =
            error instanceof Error
              ? error
              : new Error("Impossible de récupérer la session vocale du workflow.");
          if (candidate.startsWith("/") && candidates.length > 1) {
            lastError = normalized;
            continue;
          }
          throw normalized;
        }
      }

      if (lastError) {
        throw lastError;
      }

      return null;
    },
    [backendUrl, currentThreadId, token],
  );

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
          persistStoredThreadId(sessionOwner, threadId, activeWorkflowSlug);
          setInitialThreadId((current) => (current === threadId ? current : threadId));
          setCurrentThreadId((current) => (current === threadId ? current : threadId));
        },
        onThreadLoadStart: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load start", { threadId });
        },
        onThreadLoadEnd: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load end", { threadId });
        },
        onLog: (entry: { name: string; data?: Record<string, unknown> }) => {
          void handleVoiceLogEvent(entry);
          if (entry?.data && typeof entry.data === "object") {
            const data = entry.data as Record<string, unknown>;
            if ("thread" in data && data.thread) {
              lastThreadSnapshotRef.current = data.thread as Record<string, unknown>;
            }
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
      handleVoiceLogEvent,
    ],
  );

  const { control, requestRefresh } = useWorkflowChatSession({
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

  const voiceStatusMessage = useMemo(() => {
    if (voiceError) {
      return voiceError;
    }
    if (voiceIsRequestingMic) {
      return t("voiceSession.status.requestingMicrophone");
    }
    if (voiceStatus === "connecting") {
      return t("voiceSession.status.connecting");
    }
    if (voiceStatus === "connected") {
      const label = voiceStepTitle?.trim() || voiceStepSlug?.trim() || "";
      if (label) {
        return t("voiceSession.status.connectedWithStep", { step: label });
      }
      return t("voiceSession.status.connected");
    }
    return null;
  }, [t, voiceError, voiceIsRequestingMic, voiceStatus, voiceStepSlug, voiceStepTitle]);

  const statusMessage = useMemo(() => {
    if (error) {
      return error;
    }
    if (voiceStatusMessage) {
      return voiceStatusMessage;
    }
    if (isLoading) {
      return "Initialisation de la session…";
    }
    return null;
  }, [error, isLoading, voiceStatusMessage]);

  const isStatusError = Boolean(error || voiceError);
  const isStatusLoading =
    Boolean(statusMessage) &&
    !isStatusError &&
    ((isLoading && !error) || (voiceStatusMessage && (voiceStatus === "connecting" || voiceIsRequestingMic)));

  return (
    <>
      <ChatSidebar onWorkflowActivated={handleWorkflowActivated} />
      <ChatKitHost control={control} chatInstanceKey={chatInstanceKey} />
      <ChatStatusMessage message={statusMessage} isError={isStatusError} isLoading={isStatusLoading} />
    </>
  );
}
