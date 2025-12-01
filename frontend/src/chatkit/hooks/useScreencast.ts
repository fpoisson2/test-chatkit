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

    const tokenEntries: Array<{
      entry: typeof allComputerUseTasks[number];
      token: string;
    }> = [];

    allComputerUseTasks.forEach((cuEntry) => {
      const { item, task: computerUseTask } = cuEntry;
      const token =
        computerUseTask.debug_url_token ||
        computerUseTask.ssh_token ||
        computerUseTask.vnc_token;

      if (!token) {
        return;
      }

      console.log('[useScreencast] Found computer_use task with token:', {
        itemId: item.id,
        token: token.substring(0, 8),
        status: computerUseTask.status_indicator,
        workflowId: item.id,
      });

      if (failedScreencastTokens.has(token)) {
        console.log('[useScreencast] Removing token from failed list (giving it another chance):', token.substring(0, 8));
        setFailedScreencastTokens(prev => {
          const next = new Set(prev);
          next.delete(token);
          return next;
        });
      }

      tokenEntries.push({ entry: cuEntry, token });
    });

    const loadingTokenEntries = tokenEntries.filter(({ entry }) => entry.task.status_indicator === 'loading');
    const latestLoadingEntry = [...loadingTokenEntries]
      .reverse()
      .find(({ token }) => !failedScreencastTokens.has(token));

    let newActiveScreencast = latestLoadingEntry
      ? {
          token: latestLoadingEntry.token,
          itemId: latestLoadingEntry.entry.item.id,
        }
      : null;

    // If no specific task is loading, but the workflow is still in progress (isLoading),
    // and we have previously found computer use tasks, keep the latest one active.
    // This prevents flickering between tasks in an agent loop.
    if (!newActiveScreencast && isLoading && tokenEntries.length > 0) {
      const latestEntry = [...tokenEntries]
        .reverse()
        .find(({ token }) => !failedScreencastTokens.has(token));

      if (latestEntry) {
        newActiveScreencast = {
          token: latestEntry.token,
          itemId: latestEntry.entry.item.id,
        };
      }
    }

    if (!newActiveScreencast && currentActiveScreencast) {
      setActiveScreencast(null);
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

    if (newActiveScreencast &&
        (!currentActiveScreencast ||
         newActiveScreencast.token !== currentActiveScreencast.token ||
         newActiveScreencast.itemId !== currentActiveScreencast.itemId)) {
      console.log('[useScreencast] Setting active screencast:', newActiveScreencast);
      setActiveScreencast(newActiveScreencast);
    }
  }, [isLoading, threadItems, dismissedScreencastItems, failedScreencastTokens, lastScreencastScreenshot]);

  // Auto-retry failed screencasts after a short delay while the task is still active.
  // Without this, a transient 404/timeout while the browser starts would mark the token
  // as failed and it would only recover after a full page refresh.
  useEffect(() => {
    if (failedScreencastTokens.size === 0) return;

    const activeFailedTokens = Array.from(failedScreencastTokens).filter(token => {
      return threadItems.some((item: any) => {
        if (item.type !== 'workflow') return false;
        const tasks = item.workflow?.tasks || [];
        return tasks.some((task: any) =>
          task.type === 'computer_use' &&
          task.debug_url_token === token &&
          task.status_indicator !== 'complete' &&
          task.status_indicator !== 'error'
        );
      });
    });

    if (activeFailedTokens.length === 0) return;

    const retryTimeout = setTimeout(() => {
      setFailedScreencastTokens(prev => {
        const next = new Set(prev);
        activeFailedTokens.forEach(token => next.delete(token));
        return next;
      });
    }, 1500);

    return () => clearTimeout(retryTimeout);
  }, [failedScreencastTokens, threadItems]);

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
