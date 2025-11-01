import { useMemo } from "react";

type ChatSessionStatusBannerProps = {
  message: string | null;
  tone: "info" | "error" | "loading";
};

export const ChatSessionStatusBanner = ({
  message,
  tone,
}: ChatSessionStatusBannerProps) => {
  const accessibilityProps = useMemo(() => {
    if (!message) {
      return null;
    }

    if (tone === "error") {
      return {
        role: "alert" as const,
        "aria-live": "assertive" as const,
      };
    }

    return {
      role: "status" as const,
      "aria-live": "polite" as const,
      "aria-busy": tone === "loading" ? true : undefined,
    };
  }, [message, tone]);

  if (!message || !accessibilityProps) {
    return null;
  }

  const toneModifier =
    tone === "error"
      ? " chatkit-session-status--error"
      : tone === "loading"
        ? " chatkit-session-status--loading"
        : "";

  return (
    <div className={`chatkit-session-status${toneModifier}`} {...accessibilityProps}>
      {message}
    </div>
  );
};
