import { ChatKit, type ChatKitControl } from "@openai/chatkit-react";

type ChatKitHostProps = {
  control: ChatKitControl;
  chatInstanceKey: number;
};

export const ChatKitHost = ({ control, chatInstanceKey }: ChatKitHostProps) => (
  <div className="chatkit-layout__widget">
    <ChatKit
      key={chatInstanceKey}
      control={control}
      className="chatkit-host"
      style={{ width: "100%", height: "100%" }}
    />
  </div>
);
