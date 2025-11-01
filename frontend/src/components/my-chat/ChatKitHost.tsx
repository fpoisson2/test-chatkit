import { ChatKit, type ChatKitControl } from "@openai/chatkit-react";

import { ChatSessionStatusBanner } from "./ChatSessionStatusBanner";

type ChatKitHostProps = {
  control: ChatKitControl;
  chatInstanceKey: number;
  statusMessage: string | null;
  statusTone: "info" | "error" | "loading";
};

export const ChatKitHost = ({
  control,
  chatInstanceKey,
  statusMessage,
  statusTone,
}: ChatKitHostProps) => (
  <div className="chatkit-layout__widget">
    <ChatSessionStatusBanner message={statusMessage} tone={statusTone} />
    <ChatKit
      key={chatInstanceKey}
      control={control}
      className="chatkit-host"
      style={{ width: "100%", height: "100%" }}
    />
  </div>
);
