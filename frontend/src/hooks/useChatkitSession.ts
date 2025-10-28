import { useCallback, useState } from "react";

import {
  clearStoredChatKitSecret,
  normalizeSessionExpiration,
  persistChatKitSecret,
  readStoredChatKitSession,
} from "../utils/chatkitSession";
import { ApiError, fetchChatkitSession } from "../utils/backend";

export type UseChatkitSessionParams = {
  sessionOwner: string;
  storageKey: string;
  token: string | null;
  mode: "local" | "hosted";
  hostedWorkflowSlug: string | null;
  disableHostedFlow: (reason?: string | null) => void;
};

export type UseChatkitSessionResult = {
  getClientSecret: (currentSecret: string | null) => Promise<string>;
  isLoading: boolean;
  error: string | null;
  reportError: (message: string, detail?: unknown) => void;
  resetError: () => void;
};

export const useChatkitSession = ({
  sessionOwner,
  storageKey,
  token,
  mode,
  hostedWorkflowSlug,
  disableHostedFlow,
}: UseChatkitSessionParams): UseChatkitSessionResult => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const reportError = useCallback((message: string, detail?: unknown) => {
    setError(message);
    if (!message) {
      return;
    }
    const normalizeDetail = (value: unknown): string | null => {
      if (value instanceof Error) {
        return value.message;
      }
      if (typeof value === "string") {
        return value;
      }
      if (value && typeof value === "object") {
        try {
          const json = JSON.stringify(value);
          return json && json !== "{}" ? json : null;
        } catch {
          return null;
        }
      }
      return null;
    };
    const detailMessage = normalizeDetail(detail);
    if (detail !== undefined) {
      if (detailMessage) {
        console.error(`[ChatKit] ${message}: ${detailMessage}`, detail);
      } else {
        console.error(`[ChatKit] ${message}`, detail);
      }
    } else {
      console.error(`[ChatKit] ${message}`);
    }
  }, []);

  const getClientSecret = useCallback(
    async (currentSecret: string | null) => {
      if (mode !== "hosted") {
        if (import.meta.env.DEV) {
          console.debug("[ChatKit] Demande de client_secret ignorée (mode %s).", mode);
        }
        throw new Error("Client secret unavailable outside hosted mode.");
      }

      if (!hostedWorkflowSlug) {
        const message = "Aucun workflow hébergé n'est disponible.";
        disableHostedFlow(message);
        reportError(message);
        clearStoredChatKitSecret(storageKey);
        throw new Error(message);
      }

      const { session: storedSession, shouldRefresh } = readStoredChatKitSession(storageKey);

      if (currentSecret && storedSession && storedSession.secret === currentSecret && !shouldRefresh) {
        return currentSecret;
      }

      if (!currentSecret && storedSession && !shouldRefresh) {
        return storedSession.secret;
      }

      if (storedSession && shouldRefresh) {
        clearStoredChatKitSecret(storageKey);
      }

      setIsLoading(true);
      resetError();

      if (import.meta.env.DEV) {
        console.debug("[ChatKit] Demande d'un client_secret pour %s.", sessionOwner);
      }

      try {
        const data = await fetchChatkitSession({
          user: sessionOwner,
          token,
          hostedWorkflowSlug,
        });
        if (!data?.client_secret) {
          throw new Error("Missing client_secret in ChatKit session response");
        }

        const expiresAt = normalizeSessionExpiration(data.expires_at ?? data);
        persistChatKitSecret(storageKey, data.client_secret, expiresAt);

        return data.client_secret;
      } catch (err) {
        if (err instanceof ApiError) {
          const extractDetailMessage = (detail: unknown): string | null => {
            if (!detail) {
              return null;
            }
            if (typeof detail === "string") {
              return detail;
            }
            if (typeof detail === "object") {
              const record = detail as Record<string, unknown>;
              if ("detail" in record) {
                const nested = extractDetailMessage(record.detail);
                if (nested) {
                  return nested;
                }
              }
              const candidates = ["hint", "error", "message"] as const;
              for (const key of candidates) {
                const value = record[key];
                if (typeof value === "string" && value) {
                  return value;
                }
              }
            }
            return null;
          };

          const detailMessage = extractDetailMessage(err.detail) ?? err.message;
          if (import.meta.env.DEV) {
            console.error(
              "[ChatKit] Échec lors de la récupération du client_secret (%s) : %s",
              err.status ?? "inconnu",
              detailMessage,
            );
          }

          const errorCode =
            typeof err.detail === "object" && err.detail !== null
              ? (err.detail as Record<string, unknown>).error
              : null;

          if (
            (err.status === 400 || err.status === 404) &&
            (errorCode === "hosted_workflow_not_configured" || errorCode === "hosted_workflow_not_found")
          ) {
            const reason =
              errorCode === "hosted_workflow_not_found"
                ? "Le workflow hébergé sélectionné est introuvable."
                : "Aucun workflow hébergé n'est configuré sur le serveur.";
            disableHostedFlow(reason);
            reportError(reason, err);
            clearStoredChatKitSecret(storageKey);
            throw new Error(reason);
          }

          const combinedMessage = err.status
            ? `${err.status} ${detailMessage}`.trim()
            : detailMessage;

          const wrappedError = new ApiError(`Failed to fetch client secret: ${combinedMessage}`, {
            status: err.status,
            detail: err.detail,
          });
          reportError(wrappedError.message, err);
          clearStoredChatKitSecret(storageKey);
          throw wrappedError;
        }

        if (err instanceof Error) {
          reportError(err.message, err);
        } else {
          reportError("Erreur inconnue lors de la récupération du client_secret.");
        }
        clearStoredChatKitSecret(storageKey);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [
      disableHostedFlow,
      hostedWorkflowSlug,
      mode,
      reportError,
      resetError,
      sessionOwner,
      storageKey,
      token,
    ],
  );

  return {
    getClientSecret,
    isLoading,
    error,
    reportError,
    resetError,
  };
};

export type { UseChatkitSessionParams as UseChatkitSessionOptions };
