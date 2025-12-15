import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowActivation } from "../features/workflows/WorkflowSidebar";
import type { ThreadWorkflowMetadata } from "../features/workflows/ConversationsSidebarSection";
import type { WorkflowSummary } from "../types/workflows";
import type { HostedFlowMode } from "./useHostedFlow";
import { useChatContext } from "../context/ChatContext";
import { workflowsApi } from "../utils/backend";
import { clearStoredThreadId, persistStoredThreadId } from "../utils/chatkitThread";
import { resolvePersistenceSlug } from "../utils/chatStorage";

export type UseSidebarActionsOptions = {
  sessionOwner: string;
  persistenceSlug: string | null;
  mode: HostedFlowMode;
  workflows: WorkflowSummary[];
  token: string | null;
  isAdmin: boolean;
  setManagedWorkflowSelection: React.Dispatch<React.SetStateAction<WorkflowActivation>>;
  setSelectedWorkflowId: (id: number | null) => void;
};

export type SidebarActions = {
  handleSidebarThreadSelect: (threadId: string, workflowMetadata?: ThreadWorkflowMetadata) => Promise<void>;
  handleSidebarThreadDeleted: (deletedThreadId: string) => void;
  handleNewConversation: () => void;
  handleWorkflowSelectorChange: (workflowId: number) => Promise<void>;
};

export function useSidebarActions({
  sessionOwner,
  persistenceSlug,
  mode,
  workflows,
  token,
  isAdmin,
  setManagedWorkflowSelection,
  setSelectedWorkflowId,
}: UseSidebarActionsOptions): SidebarActions {
  const navigate = useNavigate();

  // Get state, setters, and refs from context
  const { state, setters, refs } = useChatContext();
  const { currentThread, initialThreadId, workflowSelection } = state;

  const {
    setCurrentThread,
    setIsNewConversationStreaming,
    setInitialThreadId,
    setChatInstanceKey,
  } = setters;
  const {
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    isNewConversationDraftRef,
  } = refs;

  const handleSidebarThreadSelect = useCallback(
    async (threadId: string, workflowMetadata?: ThreadWorkflowMetadata) => {
      console.log("[DEBUG-CONV] handleSidebarThreadSelect called", {
        threadId,
        workflowMetadata,
        currentThreadId: currentThread?.id,
        initialThreadId,
        timestamp: new Date().toISOString(),
      });

      isNewConversationDraftRef.current = false;

      const currentWorkflowId = workflowSelection.kind === "local" ? workflowSelection.workflow?.id : null;
      const threadWorkflowId = workflowMetadata?.id;

      let targetSlug = persistenceSlug;
      let workflowChanged = false;

      if (threadWorkflowId != null && threadWorkflowId !== currentWorkflowId) {
        const targetWorkflow = workflows.find((w) => w.id === threadWorkflowId);
        if (targetWorkflow) {
          targetSlug = resolvePersistenceSlug(mode, { kind: "local", workflow: targetWorkflow });

          if (isAdmin && token) {
            await workflowsApi.setChatkitWorkflow(token, threadWorkflowId).catch(() => {});
          }

          setSelectedWorkflowId(threadWorkflowId);
          setManagedWorkflowSelection({ kind: "local", workflow: targetWorkflow });
          workflowChanged = true;
        }
      }

      persistStoredThreadId(sessionOwner, threadId, targetSlug);
      navigate(`/c/${threadId}`, { replace: true });
      setInitialThreadId(threadId);

      if (workflowChanged) {
        setChatInstanceKey((v) => v + 1);
      }
    },
    [
      sessionOwner,
      persistenceSlug,
      currentThread,
      initialThreadId,
      workflowSelection,
      workflows,
      mode,
      token,
      isAdmin,
      navigate,
      isNewConversationDraftRef,
      setSelectedWorkflowId,
      setManagedWorkflowSelection,
      setInitialThreadId,
      setChatInstanceKey,
    ],
  );

  const handleSidebarThreadDeleted = useCallback(
    (deletedThreadId: string) => {
      const currentId = (currentThread?.id as string | undefined) ?? initialThreadId;
      if (currentId === deletedThreadId) {
        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
        setChatInstanceKey((v) => v + 1);
        navigate("/", { replace: true });
      }
    },
    [sessionOwner, persistenceSlug, currentThread, initialThreadId, navigate, setInitialThreadId, setChatInstanceKey],
  );

  const handleNewConversation = useCallback(() => {
    console.log("[DEBUG-CONV] handleNewConversation called", {
      sessionOwner,
      persistenceSlug,
      currentThreadId: currentThread?.id,
      initialThreadId,
      workflowsLength: workflows.length,
      timestamp: new Date().toISOString(),
    });

    clearStoredThreadId(sessionOwner, persistenceSlug);
    console.log("[DEBUG-CONV] clearStoredThreadId completed");

    lastThreadSnapshotRef.current = null;
    setCurrentThread(null);
    setIsNewConversationStreaming(false);
    wasNewConversationStreamingRef.current = false;
    isNewConversationDraftRef.current = true;
    setInitialThreadId(null);
    setChatInstanceKey((v) => v + 1);

    console.log("[DEBUG-CONV] State reset completed", {
      isNewConversationDraftRef: isNewConversationDraftRef.current,
    });

    // Reset workflow selection when starting a new conversation with multiple workflows
    // This forces the user to choose a workflow before auto-start can trigger
    if (workflows.length > 1) {
      setManagedWorkflowSelection({ kind: "local", workflow: null });
      setSelectedWorkflowId(null);
      console.log("[DEBUG-CONV] Workflow selection reset (multiple workflows)");
    }
    navigate("/", { replace: true });
    console.log("[DEBUG-CONV] Navigation to / completed");
  }, [
    sessionOwner,
    persistenceSlug,
    currentThread,
    initialThreadId,
    navigate,
    workflows.length,
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    isNewConversationDraftRef,
    setCurrentThread,
    setIsNewConversationStreaming,
    setInitialThreadId,
    setChatInstanceKey,
    setManagedWorkflowSelection,
    setSelectedWorkflowId,
  ]);

  const handleWorkflowSelectorChange = useCallback(
    async (workflowId: number) => {
      const targetWorkflow = workflows.find((w) => w.id === workflowId);
      if (targetWorkflow) {
        setSelectedWorkflowId(workflowId);
        setManagedWorkflowSelection({ kind: "local", workflow: targetWorkflow });

        if (isAdmin && token) {
          await workflowsApi.setChatkitWorkflow(token, workflowId).catch(() => {});
        }

        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
        setChatInstanceKey((v) => v + 1);
      }
    },
    [
      workflows,
      sessionOwner,
      persistenceSlug,
      token,
      isAdmin,
      setSelectedWorkflowId,
      setManagedWorkflowSelection,
      setInitialThreadId,
      setChatInstanceKey,
    ],
  );

  return {
    handleSidebarThreadSelect,
    handleSidebarThreadDeleted,
    handleNewConversation,
    handleWorkflowSelectorChange,
  };
}
