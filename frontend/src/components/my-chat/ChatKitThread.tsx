import { memo } from "react";
import { useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";
import { ChatKit } from "@openai/chatkit-react";

type ChatKitThreadProps = {
  threadId: string;
  isActive: boolean;
  chatKitOptions: ChatKitOptions;
};

export const ChatKitThread = memo(
  ({ threadId, isActive, chatKitOptions }: ChatKitThreadProps) => {
    // Chaque thread crée son propre control
    // Cela permet le streaming simultané sur plusieurs threads
    const { control } = useChatKit({
      ...chatKitOptions,
      threadId, // Force le threadId pour ce control
    });

    return (
      <div
        className="chatkit-thread"
        style={{
          display: isActive ? "block" : "none",
          height: "100%",
          width: "100%",
        }}
        data-thread-id={threadId}
      >
        <ChatKit
          control={control}
          className="chatkit-host"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    );
  }
);

ChatKitThread.displayName = "ChatKitThread";
