import { useCallback, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";

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

export function MyChat() {
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
      const res = await fetch("/api/chatkit/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user: deviceId }),
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
  }, []);

  const chatkitOptions = useMemo(
    () => ({
      api: {
        getClientSecret,
      },
      theme: {
        colorScheme: "light" as const,
      },
      composer: {
        placeholder: "Posez votre question...",
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
    }),
    [getClientSecret]
  );

  const { control } = useChatKit(chatkitOptions);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#f8fafc",
      }}
    >
      <ChatKit
        control={control}
        style={{
          flex: "1 1 auto",
          width: "100%",
          height: "100%",
        }}
      />
      <div
        style={{
          padding: "8px 16px",
          fontSize: "0.9rem",
          color: error ? "#dc2626" : "#475569",
          backgroundColor: "#ffffffcc",
          borderTop: "1px solid #e2e8f0",
        }}
      >
        {error ? error : isLoading ? "Initialisation de la session…" : "\u00A0"}
      </div>
    </div>
  );
}
