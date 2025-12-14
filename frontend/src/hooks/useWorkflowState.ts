import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowActivation } from "../features/workflows/WorkflowSidebar";
import type { WorkflowSummary } from "../types/workflows";
import type { HostedFlowMode } from "./useHostedFlow";
import type { AppearanceWorkflowReference } from "../features/appearance/AppearanceSettingsContext";
import { workflowsApi } from "../utils/backend";
import { normalizeWorkflowStorageKey, resolvePersistenceSlug } from "../utils/chatStorage";
import type { ResetChatStateOptions } from "./useResetChatState";

export type UseWorkflowStateOptions = {
  mode: HostedFlowMode;
  setMode: (mode: HostedFlowMode) => void;
  workflows: WorkflowSummary[];
  providerSelectedWorkflowId: number | null;
  setSelectedWorkflowId: (id: number | null) => void;
  token: string | null;
  isAdmin: boolean;
  isNewConversationDraftRef: React.MutableRefObject<boolean>;
  resetChatState: (options?: ResetChatStateOptions) => void;
  resetError: () => void;
};

export type WorkflowStateReturn = {
  workflowSelection: WorkflowActivation;
  setWorkflowSelection: React.Dispatch<React.SetStateAction<WorkflowActivation>>;
  workflowModes: Record<string, HostedFlowMode>;
  activeWorkflow: WorkflowSummary | null;
  activeWorkflowSlug: string | null;
  activeWorkflowId: number | null;
  hostedWorkflowSlug: string | null;
  latestWorkflowSelectionRef: React.MutableRefObject<WorkflowActivation>;
  appearanceWorkflowReference: AppearanceWorkflowReference;
  handleWorkflowActivated: (selection: WorkflowActivation, options: { reason: "initial" | "user" }) => void;
};

export function useWorkflowState({
  mode,
  setMode,
  workflows,
  providerSelectedWorkflowId,
  setSelectedWorkflowId,
  token,
  isAdmin,
  isNewConversationDraftRef,
  resetChatState,
  resetError,
}: UseWorkflowStateOptions): WorkflowStateReturn {
  const [workflowSelection, setWorkflowSelection] = useState<WorkflowActivation>({
    kind: "local",
    workflow: null,
  });
  const latestWorkflowSelectionRef = useRef<WorkflowActivation>(workflowSelection);
  const [workflowModes, setWorkflowModes] = useState<Record<string, HostedFlowMode>>({});

  // Derived state
  const activeWorkflow: WorkflowSummary | null =
    workflowSelection.kind === "local" ? workflowSelection.workflow : null;
  const activeWorkflowSlug =
    workflowSelection.kind === "local"
      ? workflowSelection.workflow?.slug ?? null
      : workflowSelection.slug;
  const activeWorkflowId =
    workflowSelection.kind === "local"
      ? workflowSelection.workflow?.id ?? null
      : null;
  const hostedWorkflowSlug =
    workflowSelection.kind === "hosted" ? workflowSelection.slug : null;

  // Appearance workflow reference
  const appearanceWorkflowReference = useMemo<AppearanceWorkflowReference>(() => {
    if (mode === "hosted") {
      return hostedWorkflowSlug ? { kind: "hosted", slug: hostedWorkflowSlug } : null;
    }
    if (activeWorkflowId != null) {
      return { kind: "local", id: activeWorkflowId };
    }
    return null;
  }, [activeWorkflowId, hostedWorkflowSlug, mode]);

  // Keep ref in sync
  useEffect(() => {
    latestWorkflowSelectionRef.current = workflowSelection;
  }, [workflowSelection]);

  // Track workflow modes
  useEffect(() => {
    const key = normalizeWorkflowStorageKey(resolvePersistenceSlug(mode, workflowSelection));
    setWorkflowModes((current) => (current[key] === mode ? current : { ...current, [key]: mode }));
  }, [mode, workflowSelection]);

  // Sync workflow from provider
  useEffect(() => {
    if (mode !== "local" || providerSelectedWorkflowId === null || !token) return;

    const currentId = workflowSelection.kind === "local" ? workflowSelection.workflow?.id ?? null : null;
    if (currentId === providerSelectedWorkflowId) return;

    const workflow = workflows.find((w) => w.id === providerSelectedWorkflowId) ?? null;
    if (workflow) {
      if (isAdmin) {
        workflowsApi.setChatkitWorkflow(token, providerSelectedWorkflowId).catch(() => {});
      }

      const selection: WorkflowActivation = { kind: "local", workflow };
      // Defer state updates to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        resetChatState({
          selection,
          preserveStoredThread: !isNewConversationDraftRef.current,
          targetMode: mode,
        });
        resetError();
        setWorkflowSelection(selection);
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [mode, providerSelectedWorkflowId, workflows, workflowSelection, resetChatState, resetError, token, isAdmin, isNewConversationDraftRef]);

  const handleWorkflowActivated = useCallback(
    (selection: WorkflowActivation, { reason }: { reason: "initial" | "user" }) => {
      const shouldPreserveStoredThread = !isNewConversationDraftRef.current;
      let shouldReset = false;
      let resetConfig: ResetChatStateOptions | null = null;

      setWorkflowSelection((current) => {
        if (selection.kind === "hosted") {
          if (mode !== "hosted") setMode("hosted");
          if (reason === "user" && current.kind !== "hosted") {
            shouldReset = true;
            resetConfig = {
              selection,
              preserveStoredThread: shouldPreserveStoredThread,
              targetMode: "hosted",
            };
          }
          return selection;
        }

        const workflow = selection.workflow;
        const previousWorkflow = current.kind === "local" ? current.workflow : null;
        const currentId = previousWorkflow?.id ?? null;
        const nextId = workflow?.id ?? null;

        const workflowKey = normalizeWorkflowStorageKey(workflow?.slug ?? null);
        const defaultModeForWorkflow = reason === "initial" ? mode : "local";
        const nextMode = workflowModes[workflowKey] ?? defaultModeForWorkflow;

        if (nextMode !== mode) setMode(nextMode);

        if ((reason === "user" || reason === "initial") && currentId !== nextId && nextId !== null) {
          shouldReset = true;
          resetConfig = {
            selection,
            preserveStoredThread: shouldPreserveStoredThread,
            targetMode: nextMode,
          };
        }

        return selection;
      });

      // Call resetChatState AFTER setWorkflowSelection to avoid updating parent during render
      if (shouldReset && resetConfig) {
        // Defer to ensure it happens after all state updates complete
        setTimeout(() => {
          resetChatState(resetConfig);
          resetError();
        }, 0);
      }
    },
    [mode, resetChatState, resetError, setMode, workflowModes, isNewConversationDraftRef],
  );

  return {
    workflowSelection,
    setWorkflowSelection,
    workflowModes,
    activeWorkflow,
    activeWorkflowSlug,
    activeWorkflowId,
    hostedWorkflowSlug,
    latestWorkflowSelectionRef,
    appearanceWorkflowReference,
    handleWorkflowActivated,
  };
}
