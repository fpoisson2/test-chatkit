import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { WorkflowActivation } from "../features/workflows/WorkflowSidebar";

export type ChatState = {
  // Thread state
  currentThread: Record<string, unknown> | null;
  initialThreadId: string | null;
  streamingThreadIds: Set<string>;
  isNewConversationStreaming: boolean;
  chatInstanceKey: number;

  // Workflow state
  workflowSelection: WorkflowActivation;
};

export type ChatStateSetters = {
  setCurrentThread: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setInitialThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setStreamingThreadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIsNewConversationStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setChatInstanceKey: React.Dispatch<React.SetStateAction<number>>;
  setWorkflowSelection: React.Dispatch<React.SetStateAction<WorkflowActivation>>;
};

export type ChatStateRefs = {
  lastThreadSnapshotRef: React.MutableRefObject<Record<string, unknown> | null>;
  wasNewConversationStreamingRef: React.MutableRefObject<boolean>;
  isNewConversationDraftRef: React.MutableRefObject<boolean>;
  isInitialMountRef: React.MutableRefObject<boolean>;
  requestRefreshRef: React.MutableRefObject<((context?: string) => Promise<void> | undefined) | null>;
  stopVoiceSessionRef: React.MutableRefObject<(() => void) | null>;
};

export type ChatContextValue = {
  state: ChatState;
  setters: ChatStateSetters;
  refs: ChatStateRefs;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export type ChatProviderProps = {
  children: ReactNode;
};

export function ChatProvider({ children }: ChatProviderProps) {
  // Thread state
  const [currentThread, setCurrentThread] = useState<Record<string, unknown> | null>(null);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  const [streamingThreadIds, setStreamingThreadIds] = useState<Set<string>>(new Set());
  const [isNewConversationStreaming, setIsNewConversationStreaming] = useState(false);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);

  // Workflow state
  const [workflowSelection, setWorkflowSelection] = useState<WorkflowActivation>({
    kind: "local",
    workflow: null,
  });

  // Refs
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const wasNewConversationStreamingRef = useRef(false);
  const isNewConversationDraftRef = useRef<boolean>(false);
  const isInitialMountRef = useRef<boolean>(true);
  const requestRefreshRef = useRef<((context?: string) => Promise<void> | undefined) | null>(null);
  const stopVoiceSessionRef = useRef<(() => void) | null>(null);

  const value: ChatContextValue = {
    state: {
      currentThread,
      initialThreadId,
      streamingThreadIds,
      isNewConversationStreaming,
      chatInstanceKey,
      workflowSelection,
    },
    setters: {
      setCurrentThread,
      setInitialThreadId,
      setStreamingThreadIds,
      setIsNewConversationStreaming,
      setChatInstanceKey,
      setWorkflowSelection,
    },
    refs: {
      lastThreadSnapshotRef,
      wasNewConversationStreamingRef,
      isNewConversationDraftRef,
      isInitialMountRef,
      requestRefreshRef,
      stopVoiceSessionRef,
    },
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

export function useChatState(): ChatState {
  return useChatContext().state;
}

export function useChatSetters(): ChatStateSetters {
  return useChatContext().setters;
}

export function useChatRefs(): ChatStateRefs {
  return useChatContext().refs;
}
