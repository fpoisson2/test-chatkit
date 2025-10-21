import { useCallback, useMemo, useState } from "react";

type UseHostedFlowParams = {
  onDisable?: () => void;
};

type UseHostedFlowResult = {
  hostedFlowEnabled: boolean;
  disableHostedFlow: (reason?: string | null) => void;
  enableHostedFlow: () => void;
};

const parseHostedFlowFlag = (rawValue: string | undefined): boolean => {
  if (!rawValue) {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();

  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }

  return ["true", "1", "yes"].includes(normalized);
};

export const useHostedFlow = ({ onDisable }: UseHostedFlowParams = {}): UseHostedFlowResult => {
  const initialHostedFlow = useMemo(
    () => parseHostedFlowFlag(import.meta.env.VITE_CHATKIT_FORCE_HOSTED),
    [],
  );
  const [hostedFlowEnabled, setHostedFlowEnabled] = useState(initialHostedFlow);

  const disableHostedFlow = useCallback(
    (reason: string | null = null) => {
      if (!hostedFlowEnabled) {
        return;
      }

      if (import.meta.env.DEV) {
        const hint = reason ? ` (${reason})` : "";
        console.info("[ChatKit] Désactivation du flux hébergé%s.", hint);
      }

      setHostedFlowEnabled(false);
      onDisable?.();
    },
    [hostedFlowEnabled, onDisable],
  );

  const enableHostedFlow = useCallback(() => {
    setHostedFlowEnabled(true);
  }, []);

  return { hostedFlowEnabled, disableHostedFlow, enableHostedFlow };
};

export type { UseHostedFlowResult };
