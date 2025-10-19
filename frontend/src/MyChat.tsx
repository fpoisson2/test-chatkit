import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { getOrCreateDeviceId } from "./utils/device";
import {
  clearStoredChatKitSecret,
  inferChatKitSessionExpiration,
  persistChatKitSecret,
  readStoredChatKitSession,
} from "./utils/chatkitSession";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import type { WorkflowSummary } from "./types/workflows";
import { ChatWorkflowSidebar } from "./features/workflows/ChatWorkflowSidebar";
import {
  chatkitApi,
  makeApiEndpointCandidates,
  type ChatKitWorkflowInfo,
} from "./utils/backend";

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

// Caractère invisible utilisé pour déclencher le démarrage automatique côté widget.
const AUTO_START_TRIGGER_MESSAGE = "\u200B";


export function MyChat() {
  const { token, user } = useAuth();
  const { openSidebar } = useAppLayout();
  const preferredColorScheme = usePreferredColorScheme();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner),
  );
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowSummary | null>(null);
  const [chatkitWorkflowInfo, setChatkitWorkflowInfo] =
    useState<ChatKitWorkflowInfo | null>(null);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [hostedFlowEnabled, setHostedFlowEnabled] = useState(() => {
    const raw = import.meta.env.VITE_CHATKIT_FORCE_HOSTED;
    if (!raw) {
      return false;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
    return normalized === "true" || normalized === "1" || normalized === "yes";
  });
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const fetchUpdatesRef = useRef<(() => Promise<void>) | null>(null);
  const lastVisibilityRefreshRef = useRef(0);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const autoStartAttemptRef = useRef(false);
  const missingDomainKeyWarningShownRef = useRef(false);

  const reportError = useCallback((message: string, detail?: unknown) => {
    setError(message);
    if (message) {
      if (detail !== undefined) {
        console.error(`[ChatKit] ${message}`, detail);
      } else {
        console.error(`[ChatKit] ${message}`);
      }
    }
  }, []);

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
          clearStoredChatKitSecret(sessionOwner);
          clearStoredThreadId(sessionOwner);
          lastThreadSnapshotRef.current = null;
          setInitialThreadId(null);
          setChatInstanceKey((value) => value + 1);
        }

        return workflow;
      });
    },
    [sessionOwner],
  );

  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;
    if (previousOwner && previousOwner !== sessionOwner) {
      clearStoredChatKitSecret(previousOwner);
      clearStoredThreadId(previousOwner);
    }
    previousSessionOwnerRef.current = sessionOwner;

    const storedThreadId = loadStoredThreadId(sessionOwner);
    setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
  }, [sessionOwner]);

  useEffect(() => {
    if (!token) {
      setChatkitWorkflowInfo(null);
      return;
    }

    let cancelled = false;

    const loadWorkflowInfo = async () => {
      try {
        const info = await chatkitApi.getWorkflow(token);
        if (!cancelled) {
          setChatkitWorkflowInfo(info);
        }
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) {
            console.warn(
              "[ChatKit] Impossible de charger le workflow actif pour déterminer le démarrage automatique.",
              err,
            );
          }
          setChatkitWorkflowInfo(null);
        }
      }
    };

    void loadWorkflowInfo();

    return () => {
      cancelled = true;
    };
  }, [token, activeWorkflow?.id, activeWorkflow?.active_version_id, activeWorkflow?.updated_at]);

  const disableHostedFlow = useCallback(
    (reason: string | null = null) => {
      if (!hostedFlowEnabled) {
        return;
      }

      if (import.meta.env.DEV) {
        const hint = reason ? ` (${reason})` : "";
        console.info("[ChatKit] Désactivation du flux hébergé%s.", hint);
      }

      clearStoredChatKitSecret(sessionOwner);
      clearStoredThreadId(sessionOwner);
      lastThreadSnapshotRef.current = null;
      setInitialThreadId(null);
      setHostedFlowEnabled(false);
      setChatInstanceKey((value) => value + 1);
    },
    [hostedFlowEnabled, sessionOwner],
  );

  const getClientSecret = useCallback(async (currentSecret: string | null) => {
    const { session: storedSession, shouldRefresh } = readStoredChatKitSession(sessionOwner);

    if (currentSecret && storedSession && storedSession.secret === currentSecret && !shouldRefresh) {
      return currentSecret;
    }

    if (!currentSecret && storedSession && !shouldRefresh) {
      return storedSession.secret;
    }

    if (storedSession && shouldRefresh) {
      clearStoredChatKitSecret(sessionOwner);
    }

    setIsLoading(true);
    setError(null);
    if (import.meta.env.DEV) {
      console.debug(
        "[ChatKit] Demande d'un client_secret pour %s (flux hébergé activé: %s).",
        sessionOwner,
        hostedFlowEnabled ? "oui" : "non",
      );
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch("/api/chatkit/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ user: sessionOwner }),
      });

      if (!res.ok) {
        const message = await res.text();
        const combinedMessage = `${res.status} ${message}`.trim();

        const normalizedMessage = (() => {
          try {
            const parsed = JSON.parse(message);
            if (parsed?.detail) {
              if (typeof parsed.detail === "string") {
                return parsed.detail;
              }
              if (typeof parsed.detail?.hint === "string") {
                return parsed.detail.hint;
              }
              if (typeof parsed.detail?.error === "string") {
                return parsed.detail.error;
              }
            }
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn("[ChatKit] Impossible d'analyser la réponse de session", err);
            }
          }
          return message;
        })();

        if (import.meta.env.DEV) {
          console.error(
            "[ChatKit] Échec lors de la récupération du client_secret (%s) : %s",
            res.status,
            normalizedMessage,
          );
        }

        if (res.status === 500 && normalizedMessage.includes("CHATKIT_WORKFLOW_ID")) {
          disableHostedFlow("CHATKIT_WORKFLOW_ID manquant");
          throw new Error(
            "Le flux hébergé a été désactivé car CHATKIT_WORKFLOW_ID n'est pas configuré côté serveur.",
          );
        }

        const errorMessage = `Failed to fetch client secret: ${combinedMessage}`;
        throw new Error(errorMessage);
      }

      const data = await res.json();
      if (!data?.client_secret) {
        throw new Error("Missing client_secret in ChatKit session response");
      }

      const expiresAt = inferChatKitSessionExpiration(data);
      persistChatKitSecret(sessionOwner, data.client_secret, expiresAt);

      return data.client_secret;
    } catch (err) {
      if (err instanceof Error) {
        reportError(err.message, err);
      } else {
        reportError("Erreur inconnue lors de la récupération du client_secret.");
      }
      clearStoredChatKitSecret(sessionOwner);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [disableHostedFlow, hostedFlowEnabled, reportError, sessionOwner, token]);

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
        uploadStrategy = { type: "direct", uploadUrl: directUploadUrl };
        attachmentsAreEnabled = true;
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
      if (resource instanceof URL) {
        return resource.href;
      }
      if (resource && typeof resource === "object" && "url" in resource) {
        const { url } = resource as { url?: string };
        return typeof url === "string" ? url : null;
      }
      return null;
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

      const targetUrl = resolveResourceUrl(resource);
      const isDomainVerificationRequest =
        typeof targetUrl === "string" && targetUrl.includes("/domain_keys/verify");

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
        const response = await fetch(resource, {
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
          setError(null);
        },
        onResponseEnd: () => {
          console.debug("[ChatKit] response end");
          const refresh = fetchUpdatesRef.current;
          if (!refresh) {
            return;
          }
          refresh().catch((err) => {
            if (import.meta.env.DEV) {
              console.warn("[ChatKit] Échec de la synchronisation après la réponse", err);
            }
          });
        },
        onThreadChange: ({ threadId }: { threadId: string | null }) => {
          console.debug("[ChatKit] thread change", { threadId });
          persistStoredThreadId(sessionOwner, threadId);
          setInitialThreadId((current) => (current === threadId ? current : threadId));
          if (threadId === null) {
            autoStartAttemptRef.current = false;
          }
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
      }) satisfies ChatKitOptions,
    [
      apiConfig,
      attachmentsConfig,
      initialThreadId,
      openSidebar,
      sessionOwner,
      activeWorkflow?.id,
      chatInstanceKey,
      preferredColorScheme,
      reportError,
    ],
  );

  const { control, fetchUpdates, sendUserMessage } = useChatKit(chatkitOptions);

  useEffect(() => {
    fetchUpdatesRef.current = fetchUpdates;
    return () => {
      fetchUpdatesRef.current = null;
    };
  }, [fetchUpdates]);

  useEffect(() => {
    if (!chatkitWorkflowInfo || !chatkitWorkflowInfo.auto_start) {
      autoStartAttemptRef.current = false;
      return;
    }

    if (initialThreadId) {
      return;
    }

    if (autoStartAttemptRef.current) {
      return;
    }

    autoStartAttemptRef.current = true;

    const configuredMessage = chatkitWorkflowInfo.auto_start_user_message ?? "";
    const payloadText = configuredMessage.trim()
      ? configuredMessage
      : AUTO_START_TRIGGER_MESSAGE;

    sendUserMessage({ text: payloadText, newThread: true })
      .then(() => {
        const refresh = fetchUpdatesRef.current;
        if (!refresh) {
          return;
        }
        return refresh().catch((err: unknown) => {
          if (import.meta.env.DEV) {
            console.warn("[ChatKit] Rafraîchissement après démarrage automatique impossible", err);
          }
        });
      })
      .catch((err: unknown) => {
        autoStartAttemptRef.current = false;
        const message =
          err instanceof Error
            ? err.message
            : "Impossible de démarrer automatiquement le workflow.";
        if (import.meta.env.DEV) {
          console.warn("[ChatKit] Échec du démarrage automatique", err);
        }
        reportError(message, err);
      });
  }, [
    chatkitWorkflowInfo?.auto_start,
    chatkitWorkflowInfo?.auto_start_user_message,
    sendUserMessage,
    initialThreadId,
    reportError,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let rafHandle: number | null = null;

    const refreshConversation = () => {
      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < 500) {
        return;
      }
      lastVisibilityRefreshRef.current = now;

      fetchUpdates().catch((err) => {
        if (import.meta.env.DEV) {
          console.warn("[ChatKit] Échec de la synchronisation après retour d'onglet", err);
        }
      });
    };

    const scheduleRefresh = () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = requestAnimationFrame(refreshConversation);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };

    const handleWindowFocus = () => {
      scheduleRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
    };
  }, [fetchUpdates]);

  const statusMessage = error ?? (isLoading ? "Initialisation de la session…" : null);

  const statusClassName = [
    "chatkit-status",
    error ? "chatkit-status--error" : "",
    !error && isLoading ? "chatkit-status--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <ChatWorkflowSidebar onWorkflowActivated={handleWorkflowActivated} />
      <div className="chatkit-layout__widget">
        <ChatKit
          key={chatInstanceKey}
          control={control}
          className="chatkit-host"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      {statusMessage && (
        <div className={statusClassName} role="status" aria-live="polite">
          {statusMessage}
        </div>
      )}
    </>
  );
}
