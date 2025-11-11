import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  disabled?: boolean;
};

export const Tooltip = ({
  content,
  children,
  side = "top",
  align = "center",
  delayDuration = 300,
  disabled = false,
}: TooltipProps) => {
  if (disabled) {
    return <>{children}</>;
  }

  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="tooltip"
          side={side}
          align={align}
          sideOffset={5}
        >
          {content}
          <TooltipPrimitive.Arrow className="tooltip__arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
};

type TooltipProviderProps = {
  children: ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
};

export const TooltipProvider = ({
  children,
  delayDuration = 300,
  skipDelayDuration = 200,
}: TooltipProviderProps) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
  >
    {children}
  </TooltipPrimitive.Provider>
);
