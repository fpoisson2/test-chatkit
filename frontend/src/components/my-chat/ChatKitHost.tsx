import { ChatKit, type ChatKitControl } from "@openai/chatkit-react";

type ChatKitHostProps = {
  control: ChatKitControl;
  chatkitKey: string;
};

export const ChatKitHost = ({ control, chatkitKey }: ChatKitHostProps) => (
  <div className="chatkit-layout__widget">
    <ChatKit
      key={chatkitKey}
      control={control}
      className="chatkit-host"
      style={{ width: "100%", height: "100%" }}
    />
  </div>
);
