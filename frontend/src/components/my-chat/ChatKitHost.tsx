import { ChatKit, type ChatKitControl } from "@openai/chatkit-react";

type ChatKitHostProps = {
  control: ChatKitControl;
};

export const ChatKitHost = ({
  control,
}: ChatKitHostProps) => (
  <div className="chatkit-layout__widget">
    <ChatKit
      control={control}
      className="chatkit-host"
      style={{ width: "100%", height: "100%" }}
    />
  </div>
);
