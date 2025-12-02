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
  dismissScreencast: (itemId: string) => void;
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
      .find(({ token, entry }) => !failedScreencastTokens.has(token) && !dismissedScreencastItems.has(entry.item.id));

    let newActiveScreencast = latestLoadingEntry
      ? {
          token: latestLoadingEntry.token,
          itemId: latestLoadingEntry.entry.item.id,
        }
      : null;

    // If no specific task is loading, we still check if we should keep an existing screencast active.
    // This handles two cases:
    // 1. Preventing flickering between tasks in an agent loop (isLoading is true)
    // 2. Keeping the screencast visible after completion until dismissed (isLoading is false)
    if (!newActiveScreencast && tokenEntries.length > 0) {
      // If we already have an active screencast, check if it's still valid (exists in tokenEntries)
      // and keep it. We prioritize maintaining the current view over switching or clearing.
      if (currentActiveScreencast) {
        const isCurrentTokenValid = tokenEntries.some(e => e.token === currentActiveScreencast.token);
        if (isCurrentTokenValid && !failedScreencastTokens.has(currentActiveScreencast.token)) {
          newActiveScreencast = currentActiveScreencast;
        }
      }

      // If we don't have an active one (or it became invalid), but we are still loading,
      // pick the latest available one to show *something*.
      // We only do this when loading to avoid aggressively showing stale sessions on load
      // if the user hasn't explicitly interacted. But if they were just watching it,
      // the logic above (currentActiveScreencast) keeps it.
      if (!newActiveScreencast && isLoading) {
        const latestEntry = [...loadingTokenEntries]
          .reverse()
          .find(({ token }) => !failedScreencastTokens.has(token));

      if (latestEntry && !dismissedScreencastItems.has(latestEntry.entry.item.id)) {
          newActiveScreencast = {
            token: latestEntry.token,
            itemId: latestEntry.entry.item.id,
          };
        }
      }
    }

    if (!newActiveScreencast && currentActiveScreencast) {
      // Only clear if we really decided we shouldn't have one anymore
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

  // Callback to explicitly dismiss a screencast for an item
  const dismissScreencast = useCallback((itemId: string) => {
    setDismissedScreencastItems(prev => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    // If the dismissed item was active, clear it
    setActiveScreencast(prev => (prev?.itemId === itemId ? null : prev));
  }, []);

  return {
    activeScreencast,
    setActiveScreencast,
    lastScreencastScreenshot,
    dismissedScreencastItems,
    failedScreencastTokens,
    handleScreencastLastFrame,
    handleScreencastConnectionError,
    dismissScreencast,
  };
}
