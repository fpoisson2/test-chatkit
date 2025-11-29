import { useParams } from "react-router-dom";
import { ChatProvider } from "./context/ChatContext";
import { MyChatContent } from "./components/my-chat/MyChatContent";
import { loadStoredThreadId } from "./utils/chatkitThread";
import { useAuth } from "./auth";
import { getOrCreateDeviceId } from "./utils/device";
import { useState } from "react";

export function MyChat() {
  const { threadId: urlThreadId } = useParams<{ threadId?: string }>();
  const { user } = useAuth();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;

  // Compute initial thread ID for context initialization
  const computedInitialThreadId = urlThreadId ?? loadStoredThreadId(sessionOwner, null);

  return (
    <ChatProvider initialThreadId={computedInitialThreadId} urlThreadId={urlThreadId}>
      <MyChatContent />
    </ChatProvider>
  );
}
