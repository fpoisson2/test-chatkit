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
  const { control } = useChatKit({
    api: {
      async getClientSecret(existing) {
        if (existing) {
          return existing.clientSecret;
        }

        const deviceId = getOrCreateDeviceId();
        const res = await fetch("/api/chatkit/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user: deviceId }),
        });

        if (!res.ok) {
          const message = await res.text();
          throw new Error(`Failed to fetch client secret: ${res.status} ${message}`);
        }

        const data = await res.json();
        if (!data?.client_secret) {
          throw new Error("Missing client_secret in ChatKit session response");
        }

        return data.client_secret;
      },
    },
  });

  return <ChatKit control={control} className="h-[600px] w-[320px]" />;
}
