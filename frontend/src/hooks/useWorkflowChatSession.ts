import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useChatKit } from "@openai/chatkit-react";
import type { ChatKitControl, ChatKitOptions } from "@openai/chatkit";

import type { WorkflowSummary } from "../types/workflows";
import { makeApiEndpointCandidates } from "../utils/backend";
import { useChatkitWorkflowSync } from "./useChatkitWorkflowSync";

type WeatherToolCall = {
  name: "get_weather";
  params: {
    city: string;
    country?: string | null;
  };
};

type ClientToolCall = WeatherToolCall;

type UseWorkflowChatSessionParams = {
  workflow: WorkflowSummary | null;
  token: string | null;
  chatInstanceKey: number;
  initialThreadId: string | null;
  setInitialThreadId: Dispatch<SetStateAction<string | null>>;
  openSidebar: () => void;
  preferredColorScheme: ChatKitOptions["theme"]["colorScheme"] | undefined;
  getClientSecret: (currentSecret: string | null) => Promise<string>;
  reportError: (message: string, detail?: unknown) => void;
  resetError: () => void;
  hostedFlowEnabled: boolean;
  onThreadPersist?: (threadId: string | null, workflowSlug: string | null) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
};

type UseWorkflowChatSessionResult = {
  control: ChatKitControl;
  requestRefresh: (context?: string) => Promise<void> | undefined;
};

type ChatConfigDebugSnapshot = {
  hostedFlow: boolean;
  apiUrl: string;
  backendCandidates: string[];
  attachments: "two_phase" | "direct" | "disabled";
  skipDomainVerification: boolean;
  domainKeySource: "custom" | "dev" | "none";
};

type SecureUrlNormalizationResult =
  | { kind: "ok"; url: string; wasUpgraded: boolean }
  | { kind: "error"; message: string };

const ensureSecureUrl = (rawUrl: string): SecureUrlNormalizationResult => {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return { kind: "error", message: "[ChatKit] URL vide détectée." };
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

const buildServerErrorMessage = (
  targetUrl: string | null | undefined,
  status: number,
  statusText: string,
  responseDetails: string | null,
) => {
  const statusLabel = status ? `${status} ${statusText || ""}`.trim() : statusText;

  if (!targetUrl) {
    return responseDetails
      ? `Erreur serveur (${statusLabel || "inconnu"}) : ${responseDetails}`
      : `Erreur serveur (${statusLabel || "inconnu"}).`;
  }

  return responseDetails
    ? `Erreur serveur (${statusLabel || "inconnu"}) lors de la requête ${targetUrl} : ${responseDetails}`
    : `Erreur serveur (${statusLabel || "inconnu"}) lors de la requête ${targetUrl}.`;
};

export const useWorkflowChatSession = ({
  workflow,
  token,
  chatInstanceKey,
  initialThreadId,
  setInitialThreadId,
  openSidebar,
  preferredColorScheme,
  getClientSecret,
  reportError,
  resetError,
  hostedFlowEnabled,
  onThreadPersist,
  onLog,
}: UseWorkflowChatSessionParams): UseWorkflowChatSessionResult => {
  const activeWorkflowSlug = workflow?.slug ?? null;
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const missingDomainKeyWarningShownRef = useRef(false);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);

  const { apiConfig, attachmentsEnabled, debugSnapshot } = useMemo(() => {
    const forceHosted = hostedFlowEnabled;

    const rawDomainKey = import.meta.env.VITE_CHATKIT_DOMAIN_KEY?.trim();
    const skipDomainVerification =
      import.meta.env.VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION?.trim().toLowerCase() === "true";
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

    if (forceHosted) {
      return {
        apiConfig: { getClientSecret },
        attachmentsEnabled: true,
        debugSnapshot: {
          hostedFlow: true,
          apiUrl: "/api/chatkit/session",
          backendCandidates: endpointCandidates,
          attachments: "two_phase" as const,
          skipDomainVerification: shouldBypassDomainCheck,
          domainKeySource,
        },
      };
    }

    const normalizedStrategy = import.meta.env.VITE_CHATKIT_UPLOAD_STRATEGY
      ?.trim()
      .toLowerCase();

    let attachmentsAreEnabled = false;
    let uploadStrategy: { type: "two_phase" } | { type: "direct"; uploadUrl: string } | undefined;

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

      if (typeof window === "undefined") {
        return { kind: "ok", resource, wasUpgraded: false, originalUrl: url, normalizedUrl: url };
      }

      const normalized = ensureSecureUrl(url);
      if (normalized.kind === "error") {
        return { kind: "error", message: normalized.message };
      }

      if (!normalized.wasUpgraded) {
        return {
          kind: "ok",
          resource,
          wasUpgraded: false,
          originalUrl: url,
          normalizedUrl: url,
        };
      }

      const upgradedUrl = normalized.url;
      if (typeof resource === "string") {
        return {
          kind: "ok",
          resource: upgradedUrl,
          wasUpgraded: true,
          originalUrl: url,
          normalizedUrl: upgradedUrl,
        };
      }

      if (typeof URL !== "undefined" && resource instanceof URL) {
        const clone = new URL(resource.toString());
        clone.protocol = "https:";
        return {
          kind: "ok",
          resource: clone,
          wasUpgraded: true,
          originalUrl: url,
          normalizedUrl: clone.href,
        };
      }

      if (resource && typeof resource === "object") {
        return {
          kind: "ok",
          resource: { ...resource, url: upgradedUrl },
          wasUpgraded: true,
          originalUrl: url,
          normalizedUrl: upgradedUrl,
        };
      }

      return {
        kind: "ok",
        resource,
        wasUpgraded: false,
        originalUrl: url,
        normalizedUrl: url,
      };
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

      if (wasUpgraded && originalUrl && normalizedUrl && originalUrl !== normalizedUrl) {
        console.info(
          "[ChatKit] URL HTTP mise à niveau vers HTTPS pour éviter le contenu mixte.",
          { initialUrl: originalUrl, upgradedUrl: normalizedUrl },
        );
      }

      if (shouldBypassDomainCheck && targetUrl?.includes("/domain_keys/verify")) {
        console.info("[ChatKit] Vérification de domaine ignorée (mode développement).");
        return new Response(JSON.stringify({ status: "skipped" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
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
        } satisfies ChatKitOptions["api"])
      : ({
          url: customApiUrl,
          fetch: authFetch,
          ...(domainKey ? { domainKey } : {}),
        } satisfies ChatKitOptions["api"]);

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
    token,
  ]);

  const debugSignature = useMemo(() => JSON.stringify(debugSnapshot), [debugSnapshot]);

  useEffect(() => {
    console.info("[ChatKit] Configuration résolue pour le widget", debugSnapshot);
  }, [debugSignature, debugSnapshot]);

  const attachmentsConfig = useMemo(
    () =>
      attachmentsEnabled
        ? ({
            enabled: true,
            maxCount: 4,
            maxSize: 10 * 1024 * 1024,
            accept: {
              "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
              "application/pdf": [".pdf"],
              "text/plain": [".txt", ".md"],
            },
          } satisfies NonNullable<ChatKitOptions["composer"]>["attachments"])
        : ({ enabled: false } satisfies NonNullable<ChatKitOptions["composer"]>["attachments"]),
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
            ],
          },
        },
        composer: {
          placeholder: "Posez votre question...",
          attachments: attachmentsConfig,
        },
        onClientTool: async (toolCall: ClientToolCall) => {
          const { name, params } = toolCall;

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
          onThreadPersist?.(threadId, activeWorkflowSlug);
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
          onLog?.(entry);
        },
      }) satisfies ChatKitOptions,
    [
      activeWorkflowSlug,
      apiConfig,
      attachmentsConfig,
      initialThreadId,
      onLog,
      onThreadPersist,
      openSidebar,
      preferredColorScheme,
      reportError,
      resetError,
      setInitialThreadId,
      chatInstanceKey,
    ],
  );

  const { control, fetchUpdates, sendUserMessage } = useChatKit(chatkitOptions);

  const { requestRefresh } = useChatkitWorkflowSync({
    token,
    activeWorkflow: workflow,
    fetchUpdates,
    sendUserMessage,
    initialThreadId,
    reportError,
  });

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
    return () => {
      requestRefreshRef.current = null;
    };
  }, [requestRefresh]);

  return { control, requestRefresh };
};

export type { UseWorkflowChatSessionResult, UseWorkflowChatSessionParams };
