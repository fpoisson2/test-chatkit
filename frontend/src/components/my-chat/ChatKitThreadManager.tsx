import { memo } from "react";
import type { ChatKitOptions } from "@openai/chatkit";
import { ChatKitThread } from "./ChatKitThread";

type ThreadInfo = {
  threadId: string;
  workflowSlug: string;
  status: { type: string; reason?: string };
  lastActivity: number;
};

type ChatKitThreadManagerProps = {
  activeThreads: Map<string, ThreadInfo>;
  currentThreadId: string | null;
  chatKitOptions: ChatKitOptions;
};

export const ChatKitThreadManager = memo(
  ({ activeThreads, currentThreadId, chatKitOptions }: ChatKitThreadManagerProps) => {
    // Si aucun thread actif, ne rien rendre
    if (activeThreads.size === 0) {
      return null;
    }

    return (
      <div className="chatkit-thread-container" style={{ height: "100%", width: "100%" }}>
        {Array.from(activeThreads.values()).map((thread) => (
          <ChatKitThread
            key={thread.threadId}
            threadId={thread.threadId}
            isActive={thread.threadId === currentThreadId}
            chatKitOptions={chatKitOptions}
          />
        ))}
      </div>
    );
  }
);

ChatKitThreadManager.displayName = "ChatKitThreadManager";
