import { useCallback, useMemo, useState } from "react";

type HostedFlowMode = "local" | "hosted";

type UseHostedFlowParams = {
  onDisable?: () => void;
};

type UseHostedFlowResult = {
  mode: HostedFlowMode;
  setMode: (mode: HostedFlowMode) => void;
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
    () => (parseHostedFlowFlag(import.meta.env.VITE_CHATKIT_FORCE_HOSTED) ? "hosted" : "local"),
    [],
  );
  const [mode, setModeState] = useState<HostedFlowMode>(initialHostedFlow);

  const applyMode = useCallback(
    (nextMode: HostedFlowMode, { reason }: { reason?: string | null } = {}) => {
      setModeState((currentMode) => {
        if (currentMode === nextMode) {
          return currentMode;
        }

        if (nextMode === "local" && currentMode === "hosted") {
          if (import.meta.env.DEV) {
            const hint = reason ? ` (${reason})` : "";
          }
          onDisable?.();
        }

        return nextMode;
      });
    },
    [onDisable],
  );

  const setMode = useCallback(
    (nextMode: HostedFlowMode) => {
      applyMode(nextMode);
    },
    [applyMode],
  );

  const disableHostedFlow = useCallback(
    (reason: string | null = null) => {
      applyMode("local", { reason });
    },
    [applyMode],
  );

  const enableHostedFlow = useCallback(() => {
    applyMode("hosted");
  }, [applyMode]);

  const hostedFlowEnabled = mode === "hosted";

  return { mode, setMode, hostedFlowEnabled, disableHostedFlow, enableHostedFlow };
};

export type { HostedFlowMode, UseHostedFlowResult };
