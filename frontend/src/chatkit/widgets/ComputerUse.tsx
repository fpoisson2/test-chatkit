import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DevToolsScreencast } from "../components/DevToolsScreencast";
import type { ComputerUseWidget } from "../types";
import { makeApiEndpointCandidates } from "../../utils/backend";
import { useWidgetContext } from "./WidgetRenderer";

const resolveHeaders = (
  authToken?: string,
  customHeaders?: Record<string, string>,
): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(customHeaders ?? {}),
  };

  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return headers;
};

export function ComputerUseWidgetComponent({
  startUrl: initialStartUrl = "https://www.google.com",
  width = 1280,
  height = 720,
  title = "Session computer use",
  description = "Démarrez un navigateur isolé et affichez son screencast sans avoir besoin d'une IA.",
  autoStart = true,
  enableInput = true,
}: ComputerUseWidget): JSX.Element {
  const { apiConfig, authToken } = useWidgetContext();
  const [startUrl, setStartUrl] = useState(initialStartUrl);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  const apiBaseUrl = apiConfig?.url || import.meta.env.VITE_BACKEND_URL || "";
  const headers = useMemo(
    () => resolveHeaders(authToken, apiConfig?.headers),
    [authToken, apiConfig?.headers],
  );

  const callApi = useCallback(
    async (path: string, init: RequestInit) => {
      const candidates = makeApiEndpointCandidates(apiBaseUrl, path);
      let lastError: Error | null = null;

      for (const endpoint of candidates) {
        try {
          const response = await fetch(endpoint, {
            ...init,
            headers: {
              ...headers,
              ...(init.headers || {}),
            },
          });

          if (response.ok) {
            return response;
          }

          const payload = await response.json().catch(() => null);
          const message = payload?.detail || `${response.status} ${response.statusText}`;
          lastError = new Error(message);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("Network error");
        }
      }

      throw lastError ?? new Error("Impossible de joindre le backend");
    },
    [apiBaseUrl, headers],
  );

  const startBrowser = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await callApi("/api/computer/browser/start", {
        method: "POST",
        body: JSON.stringify({
          url: startUrl || null,
          width,
          height,
        }),
      });

      const data = await response.json();
      setSessionToken(data.token);
    } catch (err) {
      setSessionToken(null);
      setError(err instanceof Error ? err.message : "Impossible de démarrer le navigateur");
    } finally {
      setIsLoading(false);
    }
  }, [callApi, height, startUrl, width]);

  const restartBrowser = useCallback(async () => {
    setSessionToken(null);
    await startBrowser();
  }, [startBrowser]);

  useEffect(() => {
    if (autoStart && !hasAutoStarted && !sessionToken && !isLoading) {
      setHasAutoStarted(true);
      void startBrowser();
    }
  }, [autoStart, hasAutoStarted, isLoading, sessionToken, startBrowser]);

  return (
    <div className="chatkit-computer-use-block">
      <div className="chatkit-computer-use-header">
        <div>
          <div className="chatkit-computer-use-title">{title}</div>
          {description && <div className="chatkit-computer-use-description">{description}</div>}
        </div>
        <button
          type="button"
          className="chatkit-computer-use-button"
          onClick={sessionToken ? restartBrowser : startBrowser}
          disabled={isLoading}
        >
          {isLoading ? "Démarrage..." : sessionToken ? "Redémarrer" : "Démarrer"}
        </button>
      </div>

      <div className="chatkit-computer-use-controls">
        <label className="chatkit-computer-use-label" htmlFor="computer-use-start-url">
          URL de départ
        </label>
        <div className="chatkit-computer-use-input-row">
          <input
            id="computer-use-start-url"
            type="text"
            value={startUrl}
            className="chatkit-computer-use-input"
            onChange={(event) => setStartUrl(event.target.value)}
            placeholder="https://www.google.com"
            disabled={isLoading}
          />
          <button
            type="button"
            className="chatkit-computer-use-button chatkit-computer-use-button--secondary"
            onClick={startBrowser}
            disabled={isLoading}
          >
            Lancer
          </button>
        </div>
      </div>

      {error && (
        <div className="chatkit-computer-use-alert chatkit-computer-use-alert--error" role="alert">
          {error}
        </div>
      )}

      {sessionToken ? (
        <div className="chatkit-computer-use-cast">
          <DevToolsScreencast
            debugUrlToken={sessionToken}
            authToken={authToken}
            enableInput={enableInput}
            onConnectionError={() => setError("Connexion perdue avec le navigateur")}
            className="chatkit-computer-use-screencast"
          />
        </div>
      ) : (
        <div className="chatkit-computer-use-placeholder">
          Lancez un navigateur pour afficher le screencast en direct.
        </div>
      )}
    </div>
  );
}
