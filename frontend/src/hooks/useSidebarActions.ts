import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowActivation } from "../features/workflows/WorkflowSidebar";
import type { ThreadWorkflowMetadata } from "../features/workflows/ConversationsSidebarSection";
import type { WorkflowSummary } from "../types/workflows";
import type { HostedFlowMode } from "./useHostedFlow";
import { workflowsApi } from "../utils/backend";
import { clearStoredThreadId, persistStoredThreadId } from "../utils/chatkitThread";
import { resolvePersistenceSlug } from "../utils/chatStorage";

export type SidebarActionRefs = {
  lastThreadSnapshotRef: React.MutableRefObject<Record<string, unknown> | null>;
  wasNewConversationStreamingRef: React.MutableRefObject<boolean>;
  isNewConversationDraftRef: React.MutableRefObject<boolean>;
};

export type SidebarActionSetters = {
  setCurrentThread: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setIsNewConversationStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setInitialThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setChatInstanceKey: React.Dispatch<React.SetStateAction<number>>;
  setWorkflowSelection: React.Dispatch<React.SetStateAction<WorkflowActivation>>;
  setSelectedWorkflowId: (id: number | null) => void;
};

export type UseSidebarActionsOptions = {
  sessionOwner: string;
  persistenceSlug: string | null;
  mode: HostedFlowMode;
  workflowSelection: WorkflowActivation;
  workflows: WorkflowSummary[];
  currentThread: Record<string, unknown> | null;
  initialThreadId: string | null;
  token: string | null;
  isAdmin: boolean;
  refs: SidebarActionRefs;
  setters: SidebarActionSetters;
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
  workflowSelection,
  workflows,
  currentThread,
  initialThreadId,
  token,
  isAdmin,
  refs,
  setters,
}: UseSidebarActionsOptions): SidebarActions {
  const navigate = useNavigate();

  const {
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    isNewConversationDraftRef,
  } = refs;

  const {
    setCurrentThread,
    setIsNewConversationStreaming,
    setInitialThreadId,
    setChatInstanceKey,
    setWorkflowSelection,
    setSelectedWorkflowId,
  } = setters;

  const handleSidebarThreadSelect = useCallback(
    async (threadId: string, workflowMetadata?: ThreadWorkflowMetadata) => {
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
            await workflowsApi.setChatkitWorkflow(token, threadWorkflowId).catch(console.error);
          }

          setSelectedWorkflowId(threadWorkflowId);
          setWorkflowSelection({ kind: "local", workflow: targetWorkflow });
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
      workflowSelection,
      workflows,
      mode,
      token,
      isAdmin,
      navigate,
      isNewConversationDraftRef,
      setSelectedWorkflowId,
      setWorkflowSelection,
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
    clearStoredThreadId(sessionOwner, persistenceSlug);
    lastThreadSnapshotRef.current = null;
    setCurrentThread(null);
    setIsNewConversationStreaming(false);
    wasNewConversationStreamingRef.current = false;
    isNewConversationDraftRef.current = true;
    setInitialThreadId(null);
    setChatInstanceKey((v) => v + 1);
    navigate("/", { replace: true });
  }, [
    sessionOwner,
    persistenceSlug,
    navigate,
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    isNewConversationDraftRef,
    setCurrentThread,
    setIsNewConversationStreaming,
    setInitialThreadId,
    setChatInstanceKey,
  ]);

  const handleWorkflowSelectorChange = useCallback(
    async (workflowId: number) => {
      const targetWorkflow = workflows.find((w) => w.id === workflowId);
      if (targetWorkflow) {
        setSelectedWorkflowId(workflowId);
        setWorkflowSelection({ kind: "local", workflow: targetWorkflow });

        if (isAdmin && token) {
          await workflowsApi.setChatkitWorkflow(token, workflowId).catch(console.error);
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
      setWorkflowSelection,
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
