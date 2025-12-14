import { useMemo } from "react";
import type { MutableRefObject } from "react";
import type { ChatKitOptions } from "@openai/chatkit";

import { makeApiEndpointCandidates, getBackendBaseUrl } from "../utils/backend";

export type ChatConfigDebugSnapshot = {
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

type UseChatApiConfigParams = {
  token: string | null;
  hostedFlowEnabled: boolean;
  getClientSecret: () => Promise<string>;
  missingDomainKeyWarningShownRef: MutableRefObject<boolean>;
};

export const useChatApiConfig = ({
  token,
  hostedFlowEnabled,
  getClientSecret,
  missingDomainKeyWarningShownRef,
}: UseChatApiConfigParams) =>
  useMemo<{
    apiConfig: ChatKitOptions["api"];
    attachmentsEnabled: boolean;
    debugSnapshot: ChatConfigDebugSnapshot;
  }>(() => {
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
        "[ChatKit] Domaine personnalisé '%s' détecté sans VITE_CHATKIT_DOMAIN_KEY. Ajoutez la clé fournie par la console OpenAI pour éviter la désactivation du widget.",
        host || "inconnu",
      );
      missingDomainKeyWarningShownRef.current = true;
    }

    const explicitCustomUrl = import.meta.env.VITE_CHATKIT_API_URL?.trim();
    const backendBaseUrl = getBackendBaseUrl();
    const endpointCandidates = makeApiEndpointCandidates(
      backendBaseUrl ?? "",
      "/api/chatkit",
    );
    const defaultRelativeUrl = endpointCandidates[0];
    const absoluteCandidate = endpointCandidates.find((candidate) =>
      /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate) || candidate.startsWith("//"),
    );
    const customApiUrl =
      explicitCustomUrl || absoluteCandidate || defaultRelativeUrl || "/api/chatkit";
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

    const normalizedStrategy = import.meta.env.VITE_CHATKIT_UPLOAD_STRATEGY?.trim()?.toLowerCase();

    let attachmentsAreEnabled = false;
    let uploadStrategy:
      | { type: "two_phase" }
      | { type: "direct"; uploadUrl: string }
      | undefined;

    if (!normalizedStrategy) {
      if (explicitCustomUrl) {
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
              "[ChatKit] URL de téléchargement directe mise à niveau vers HTTPS pour éviter le contenu mixte.",
            );
          }

          uploadStrategy = { type: "direct", uploadUrl: normalizedDirectUpload.url };
          attachmentsAreEnabled = true;
        } else {
        }
      } else {
          "[ChatKit] VITE_CHATKIT_UPLOAD_STRATEGY=direct nécessite VITE_CHATKIT_DIRECT_UPLOAD_URL. Les pièces jointes restent désactivées.",
        );
      }
    } else {
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
          "[ChatKit] URL HTTP mise à niveau vers HTTPS pour éviter le contenu mixte.",
          { initialUrl: originalUrl, upgradedUrl: normalizedUrl },
        );
      }

      if (shouldBypassDomainCheck && targetUrl?.includes("/domain_keys/verify")) {
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

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const customApiConfig = uploadStrategy
      ? ({
          url: customApiUrl,
          headers,
          fetch: authFetch,
          uploadStrategy,
          ...(domainKey ? { domainKey } : {}),
        } as ChatKitOptions["api"])
      : ({
          url: customApiUrl,
          headers,
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
