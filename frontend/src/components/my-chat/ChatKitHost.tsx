import type { CSSProperties } from "react";
import { ChatKit, type ChatKitControl } from "@openai/chatkit-react";

type ChatKitHostProps = {
  control: ChatKitControl;
  chatInstanceKey: number;
  instanceId: string;
  className?: string;
  style?: CSSProperties;
};

export const ChatKitHost = ({
  control,
  chatInstanceKey,
  instanceId,
  className,
  style,
}: ChatKitHostProps) => {
  const containerClassName = className
    ? `chatkit-layout__widget ${className}`
    : "chatkit-layout__widget";

  return (
    <div
      className={containerClassName}
      style={style}
      data-chat-instance={instanceId}
    >
      <ChatKit
        key={chatInstanceKey}
        control={control}
        className="chatkit-host"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
