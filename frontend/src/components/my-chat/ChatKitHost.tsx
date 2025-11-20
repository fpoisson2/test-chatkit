import { ChatKit, type ChatKitControl, type ChatKitOptions } from "../../chatkit";

type ChatKitHostProps = {
  control: ChatKitControl;
  options: ChatKitOptions;
  chatInstanceKey: number;
};

export const ChatKitHost = ({
  control,
  options,
  chatInstanceKey,
}: ChatKitHostProps) => (
  <div className="chatkit-layout__widget">
    <ChatKit
      key={chatInstanceKey}
      control={control}
      options={options}
      className="chatkit-host"
      style={{ width: "100%", height: "100%" }}
    />
  </div>
);
