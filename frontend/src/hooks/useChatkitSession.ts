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
  disableHostedFlow,
}: UseChatkitSessionParams): UseChatkitSessionResult => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

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

  const getClientSecret = useCallback(
    async (currentSecret: string | null) => {
      if (mode !== "hosted") {
        if (import.meta.env.DEV) {
          console.debug("[ChatKit] Demande de client_secret ignorée (mode %s).", mode);
        }
        throw new Error("Client secret unavailable outside hosted mode.");
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

          if (err.status === 500 && detailMessage.includes("CHATKIT_WORKFLOW_ID")) {
            disableHostedFlow("CHATKIT_WORKFLOW_ID manquant");
            const workflowError = new Error(
              "Le flux hébergé a été désactivé car CHATKIT_WORKFLOW_ID n'est pas configuré côté serveur.",
            );
            reportError(workflowError.message, err);
            clearStoredChatKitSecret(storageKey);
            throw workflowError;
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
    [disableHostedFlow, mode, reportError, resetError, sessionOwner, storageKey, token],
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
