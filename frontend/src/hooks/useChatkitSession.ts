import { useCallback, useState } from "react";

import {
  clearStoredChatKitSecret,
  normalizeSessionExpiration,
  persistChatKitSecret,
  readStoredChatKitSession,
} from "../utils/chatkitSession";

export type UseChatkitSessionParams = {
  sessionOwner: string;
  token: string | null;
  hostedFlowEnabled: boolean;
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
  token,
  hostedFlowEnabled,
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
      resetError();

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

        const expiresAt = normalizeSessionExpiration(data.expires_at ?? data);
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
    },
    [disableHostedFlow, hostedFlowEnabled, reportError, resetError, sessionOwner, token],
  );

  return {
    getClientSecret,
    isLoading,
    error,
    reportError,
    resetError,
  };
};
