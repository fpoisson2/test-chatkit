// This file contains all the logic extracted from WorkflowBuilderPage
// It provides the WorkflowBuilder context to child components

import { type ReactNode } from "react";
import WorkflowBuilderContext from "./contexts/WorkflowBuilderContext";

// Import the hook that contains all the logic
import { useWorkflowBuilderState } from "./hooks/useWorkflowBuilderState";

type WorkflowBuilderProviderProps = {
  children: ReactNode;
};

export const WorkflowBuilderProvider = ({ children }: WorkflowBuilderProviderProps) => {
  // Use the hook that contains all the logic
  const contextValue = useWorkflowBuilderState();

  return (
    <WorkflowBuilderContext.Provider value={contextValue}>
      {children}
    </WorkflowBuilderContext.Provider>
  );
};

export default WorkflowBuilderProvider;
