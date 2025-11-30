import { useState, useRef, useEffect, useCallback } from 'react';
import type { ThreadItem } from '../types';

export interface ScreencastState {
  token: string;
  itemId: string;
}

export interface ScreencastScreenshot {
  itemId: string;
  src: string;
  action?: string;
}

export interface UseScreencastOptions {
  threadId: string | undefined;
  threadItems: ThreadItem[];
  isLoading: boolean;
}

export interface UseScreencastReturn {
  activeScreencast: ScreencastState | null;
  setActiveScreencast: React.Dispatch<React.SetStateAction<ScreencastState | null>>;
  lastScreencastScreenshot: ScreencastScreenshot | null;
  dismissedScreencastItems: Set<string>;
  failedScreencastTokens: Set<string>;
  handleScreencastLastFrame: (itemId: string) => (frameDataUrl: string) => void;
  handleScreencastConnectionError: (token: string) => void;
}

/**
 * Hook to manage screencast state and lifecycle
 */
export function useScreencast({
  threadId,
  threadItems,
  isLoading,
}: UseScreencastOptions): UseScreencastReturn {
  const [activeScreencast, setActiveScreencast] = useState<ScreencastState | null>(null);
  const [lastScreencastScreenshot, setLastScreencastScreenshot] = useState<ScreencastScreenshot | null>(null);
  const [dismissedScreencastItems, setDismissedScreencastItems] = useState<Set<string>>(new Set());
  const [failedScreencastTokens, setFailedScreencastTokens] = useState<Set<string>>(new Set());

  // Ref to track activeScreencast without triggering useEffect re-runs
  const activeScreencastRef = useRef<ScreencastState | null>(null);

  // Clear failed tokens when thread changes (new thread or switching threads)
  useEffect(() => {
    setFailedScreencastTokens(new Set());
    setDismissedScreencastItems(new Set());
    setLastScreencastScreenshot(null);
    setActiveScreencast(null);
  }, [threadId]);

  // Keep ref in sync with state
  useEffect(() => {
    activeScreencastRef.current = activeScreencast;
  }, [activeScreencast]);

  // Manage active screencast based on workflow state
  useEffect(() => {
    const items = threadItems || [];
    const workflows = items.filter((i: any) => i.type === 'workflow');
    const lastWorkflow = workflows[workflows.length - 1];

    // Use ref to avoid re-running this effect when activeScreencast changes
    const currentActiveScreencast = activeScreencastRef.current;

    // First pass: find ALL computer_use tasks across all workflows
    const allComputerUseTasks: Array<{
      item: any;
      task: any;
      taskIndex: number;
      workflowIndex: number;
      isLoading: boolean;
      isTerminal: boolean;
    }> = [];

    workflows.forEach((item: any, workflowIdx: number) => {
      if (dismissedScreencastItems.has(item.id)) {
        return;
      }

      const tasks = item.workflow?.tasks || [];
      tasks.forEach((task: any, taskIdx: number) => {
        if (task.type !== 'computer_use') return;

        const taskIsLoading = task.status_indicator === 'loading';
        const isComplete = task.status_indicator === 'complete';
        const isError = task.status_indicator === 'error';
        const isTerminal = isComplete || isError;

        allComputerUseTasks.push({
          item,
          task,
          taskIndex: taskIdx,
          workflowIndex: workflowIdx,
          isLoading: taskIsLoading,
          isTerminal,
        });
      });
    });

    // Get the latest (most recent) computer_use task
    const latestComputerUseEntry = allComputerUseTasks[allComputerUseTasks.length - 1];
    const latestComputerUseTask = latestComputerUseEntry
      ? { itemId: latestComputerUseEntry.item.id, token: latestComputerUseEntry.task.debug_url_token, status: latestComputerUseEntry.task.status_indicator }
      : null;

    let newActiveScreencast: ScreencastState | null = null;
    let currentScreencastIsComplete = false;

    // Second pass: determine the active screencast
    allComputerUseTasks.forEach((cuEntry, index) => {
      const { item, task: computerUseTask, workflowIndex, isLoading: taskIsLoading, isTerminal } = cuEntry;
      const isLastComputerUseTask = index === allComputerUseTasks.length - 1;
      const isLastWorkflow = lastWorkflow && lastWorkflow.id === item.id;
      const isLastWorkflowAndStreaming = isLastWorkflow && isLoading;

      const hasNewerWorkflow = workflowIndex >= 0 && workflowIndex < workflows.length - 1;
      const hasNewerComputerUseTask = index < allComputerUseTasks.length - 1;
      const isEffectivelyDone = isTerminal || hasNewerWorkflow || hasNewerComputerUseTask;

      if (isEffectivelyDone && currentActiveScreencast && computerUseTask.debug_url_token === currentActiveScreencast.token) {
        currentScreencastIsComplete = true;
      }

      if (isLastComputerUseTask && computerUseTask.debug_url_token && !isEffectivelyDone &&
          !failedScreencastTokens.has(computerUseTask.debug_url_token)) {
        // Show screencast if it's not done (terminal) and has a token, regardless of loading state
        // This supports manual mode where the task might be paused waiting for user input
        newActiveScreencast = {
          token: computerUseTask.debug_url_token,
          itemId: item.id,
        };
      }
    });

    // Handle token mismatch
    if (currentActiveScreencast && latestComputerUseTask &&
        currentActiveScreencast.token !== latestComputerUseTask.token) {
      currentScreencastIsComplete = true;
    }

    // Handle failed tokens
    if (currentActiveScreencast && failedScreencastTokens.has(currentActiveScreencast.token)) {
      currentScreencastIsComplete = true;
    }

    const latestComputerUseIsTerminal = latestComputerUseEntry?.isTerminal ?? false;
    const hasLoadingComputerUse = allComputerUseTasks.some(t => t.isLoading);

    // Priority 1: Close screencast if needed
    if (currentScreencastIsComplete || (latestComputerUseIsTerminal && !newActiveScreencast && !hasLoadingComputerUse)) {
      if (currentActiveScreencast) {
        setActiveScreencast(null);
      }
      if (lastScreencastScreenshot) {
        const screenshotWorkflow = workflows.find((w: any) => w.id === lastScreencastScreenshot.itemId);
        const screenshotTask = screenshotWorkflow?.workflow?.tasks?.find((t: any) => t.type === 'computer_use');
        if (screenshotTask) {
          const isActuallyTerminal = screenshotTask.status_indicator === 'complete' || screenshotTask.status_indicator === 'error';
          if (isActuallyTerminal) {
            setLastScreencastScreenshot(null);
          }
        }
      }
    }
    // Priority 2: Activate new screencast if different
    else if (newActiveScreencast &&
             (newActiveScreencast.token !== currentActiveScreencast?.token ||
              newActiveScreencast.itemId !== currentActiveScreencast?.itemId)) {
      setActiveScreencast(newActiveScreencast);
    }
  }, [isLoading, threadItems, dismissedScreencastItems, failedScreencastTokens, lastScreencastScreenshot]);

  // Callback for last frame (screenshots now handled by backend)
  const handleScreencastLastFrame = useCallback((itemId: string) => {
    return (_frameDataUrl: string) => {
      // Screenshot is now emitted by backend, no need to store it here
    };
  }, []);

  // Callback for connection errors
  const handleScreencastConnectionError = useCallback((token: string) => {
    setFailedScreencastTokens(prev => {
      if (prev.has(token)) return prev;
      const next = new Set(prev);
      next.add(token);
      return next;
    });
  }, []);

  return {
    activeScreencast,
    setActiveScreencast,
    lastScreencastScreenshot,
    dismissedScreencastItems,
    failedScreencastTokens,
    handleScreencastLastFrame,
    handleScreencastConnectionError,
  };
}
