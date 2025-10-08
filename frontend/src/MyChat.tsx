import { useCallback, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";

const DEVICE_ID_STORAGE_KEY = "chatkit-device-id";

const getOrCreateDeviceId = () => {
  if (typeof window === "undefined") {
    return crypto.randomUUID();
  }

  let existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!existing) {
    existing = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, existing);
  }
  return existing;
};

type WeatherToolCall = {
  name: "get_weather";
  params: {
    city: string;
    country?: string | null;
  };
};

type ClientToolCall = WeatherToolCall;

export function MyChat() {
  const { token, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);

  const getClientSecret = useCallback(async (currentSecret: string | null) => {
    if (currentSecret) {
      return currentSecret;
    }

    const deviceId = getOrCreateDeviceId();
    setIsLoading(true);
    setError(null);

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
        body: JSON.stringify({ user: user?.email ?? deviceId }),
      });

      if (!res.ok) {
        const message = await res.text();
        const errorMessage = `Failed to fetch client secret: ${res.status} ${message}`;
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      const data = await res.json();
      if (!data?.client_secret) {
        const errorMessage = "Missing client_secret in ChatKit session response";
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      return data.client_secret;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [token, user]);

  const chatkitOptions = useMemo(
    () =>
      ({
        api: {
          getClientSecret,
        },
        theme: {
          colorScheme: "light" as const,
        },
        composer: {
          placeholder: "Posez votre question...",
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
                  `Échec de l'appel météo (${response.status}) : ${details || "réponse vide"}`
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
          setError(error.message);
        },
        onResponseStart: () => {
          setError(null);
        },
        onResponseEnd: () => {
          console.debug("[ChatKit] response end");
        },
        onThreadChange: ({ threadId }: { threadId: string | null }) => {
          console.debug("[ChatKit] thread change", { threadId });
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
    [getClientSecret]
  );

  const { control } = useChatKit(chatkitOptions);

  const statusMessage = error
    ? error
    : isLoading
      ? "Initialisation de la session…"
      : "Votre assistant est prêt à répondre.";

  const statusClassName = [
    "status-banner",
    error ? "status-banner--error" : "",
    !error && isLoading ? "status-banner--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-shell__content">
      <div className="chat-card">
        <ChatKit
          control={control}
          className="chatkit-host"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div className={statusClassName}>{statusMessage}</div>
    </div>
  );
}
