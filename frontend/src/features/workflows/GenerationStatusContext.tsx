import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type GenerationStatusContextValue = {
  // Map de workflowId -> isGenerating
  generationStatus: Map<string, boolean>;
  setWorkflowGenerating: (workflowId: string, isGenerating: boolean) => void;
  isWorkflowGenerating: (workflowId: string) => boolean;
};

const GenerationStatusContext = createContext<GenerationStatusContextValue | undefined>(undefined);

export const useGenerationStatus = () => {
  const context = useContext(GenerationStatusContext);
  if (!context) {
    throw new Error("useGenerationStatus must be used within GenerationStatusProvider");
  }
  return context;
};

type GenerationStatusProviderProps = {
  children: ReactNode;
};

export const GenerationStatusProvider = ({ children }: GenerationStatusProviderProps) => {
  const [generationStatus, setGenerationStatus] = useState<Map<string, boolean>>(new Map());

  const setWorkflowGenerating = useCallback((workflowId: string, isGenerating: boolean) => {
    setGenerationStatus((prev) => {
      const next = new Map(prev);
      if (isGenerating) {
        next.set(workflowId, true);
      } else {
        next.delete(workflowId);
      }
      return next;
    });
  }, []);

  const isWorkflowGenerating = useCallback(
    (workflowId: string) => {
      return generationStatus.get(workflowId) ?? false;
    },
    [generationStatus],
  );

  const contextValue = useMemo<GenerationStatusContextValue>(
    () => ({
      generationStatus,
      setWorkflowGenerating,
      isWorkflowGenerating,
    }),
    [generationStatus, setWorkflowGenerating, isWorkflowGenerating],
  );

  return (
    <GenerationStatusContext.Provider value={contextValue}>
      {children}
    </GenerationStatusContext.Provider>
  );
};
