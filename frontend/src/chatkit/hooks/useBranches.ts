/**
 * Hook for managing conversation branches
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  Branch,
  BranchListResponse,
  CreateBranchResponse,
  ChatKitAPIConfig,
} from '../types';
import { MAIN_BRANCH_ID } from '../types';

export interface UseBranchesOptions {
  api: ChatKitAPIConfig;
  threadId: string | null | undefined;
  onError?: (error: { error: Error }) => void;
  onLog?: (entry: { name: string; data?: Record<string, unknown> }) => void;
  onBranchChange?: (branchId: string) => void;
}

export interface UseBranchesReturn {
  /** List of all branches for the current thread */
  branches: Branch[];
  /** Current active branch ID */
  currentBranchId: string;
  /** Whether branches have been loaded for the current thread */
  isBranchesLoaded: boolean;
  /** Maximum allowed branches (0 = unlimited) */
  maxBranches: number;
  /** Whether a new branch can be created */
  canCreateBranch: boolean;
  /** Whether branches are currently loading */
  isLoadingBranches: boolean;
  /** Create a new branch from a fork point */
  createBranch: (
    forkAfterItemId: string,
    name?: string
  ) => Promise<CreateBranchResponse | null>;
  /** Switch to a different branch */
  switchBranch: (branchId: string) => Promise<boolean>;
  /** Reload branches from server */
  reloadBranches: () => Promise<void>;
}

/**
 * Hook for managing conversation branches
 */
export function useBranches(options: UseBranchesOptions): UseBranchesReturn {
  const { api, threadId, onError, onLog, onBranchChange } = options;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranchId, setCurrentBranchId] = useState<string>(MAIN_BRANCH_ID);
  const [maxBranches] = useState<number>(0); // 0 = unlimited, can be made configurable
  const [isLoadingBranches, setIsLoadingBranches] = useState<boolean>(false);
  const [isBranchesLoaded, setIsBranchesLoaded] = useState<boolean>(false);

  // Track if we've loaded branches for the current thread
  const loadedThreadIdRef = useRef<string | null>(null);

  // Load branches when thread changes
  const loadBranches = useCallback(async () => {
    if (!threadId) {
      setBranches([]);
      setCurrentBranchId(MAIN_BRANCH_ID);
      setIsBranchesLoaded(false);
      return;
    }

    setIsLoadingBranches(true);

    // Debug: log the api.url to identify duplication source
    console.log('[useBranches] api.url:', api.url);

    // Remove any duplicate /api/chatkit segments in the URL
    let baseUrl = api.url;
    while (baseUrl.includes('/api/chatkit/api/chatkit')) {
      baseUrl = baseUrl.replace('/api/chatkit/api/chatkit', '/api/chatkit');
    }
    const branchesUrl = `${baseUrl}/threads/${threadId}/branches`;
    console.log('[useBranches] branchesUrl:', branchesUrl);

    try {
      const response = await fetch(
        branchesUrl,
        {
          method: 'GET',
          headers: {
            ...api.headers,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to load branches: ${response.status}`);
      }

      const data: BranchListResponse = await response.json();
      setBranches(data.branches);
      setCurrentBranchId(data.current_branch_id);
      setIsBranchesLoaded(true);

      onLog?.({
        name: 'branches.loaded',
        data: { count: data.branches.length, current: data.current_branch_id },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.({ error });
      // On error, reset to default state
      setBranches([]);
      setCurrentBranchId(MAIN_BRANCH_ID);
      setIsBranchesLoaded(false);
    } finally {
      setIsLoadingBranches(false);
    }
  }, [threadId, api.url, api.headers, onError, onLog]);

  // Load branches when thread changes
  useEffect(() => {
    if (threadId !== loadedThreadIdRef.current) {
      loadedThreadIdRef.current = threadId || null;
      loadBranches();
    }
  }, [threadId, loadBranches]);

  // Create a new branch
  const createBranch = useCallback(
    async (
      forkAfterItemId: string,
      name?: string
    ): Promise<CreateBranchResponse | null> => {
      console.log('[useBranches.createBranch] Called with:', { threadId, forkAfterItemId, name });

      if (!threadId) {
        console.warn('[useBranches.createBranch] No threadId, returning null');
        return null;
      }

      try {
        // Remove any duplicate /api/chatkit segments in the URL
        let baseUrl = api.url;
        while (baseUrl.includes('/api/chatkit/api/chatkit')) {
          baseUrl = baseUrl.replace('/api/chatkit/api/chatkit', '/api/chatkit');
        }
        const createUrl = `${baseUrl}/threads/${threadId}/branches`;
        console.log('[useBranches.createBranch] POST URL:', createUrl);

        const response = await fetch(
          createUrl,
          {
            method: 'POST',
            headers: {
              ...api.headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fork_after_item_id: forkAfterItemId,
              name,
            }),
          }
        );

        console.log('[useBranches.createBranch] Response status:', response.status);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[useBranches.createBranch] Error response:', errorData);
          throw new Error(
            errorData.detail?.error || `Failed to create branch: ${response.status}`
          );
        }

        const data: CreateBranchResponse = await response.json();
        console.log('[useBranches.createBranch] Success:', data);

        // Update local state
        const newBranch: Branch = {
          branch_id: data.branch_id,
          name: data.name,
          is_default: data.is_default,
          parent_branch_id: data.parent_branch_id,
          fork_point_item_id: data.fork_point_item_id,
          created_at: data.created_at,
        };

        setBranches((prev) => [...prev, newBranch]);
        setCurrentBranchId(data.branch_id);

        onLog?.({
          name: 'branches.created',
          data: { branchId: data.branch_id, forkPoint: forkAfterItemId },
        });

        onBranchChange?.(data.branch_id);

        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
        return null;
      }
    },
    [threadId, api.url, api.headers, onError, onLog, onBranchChange]
  );

  // Switch to a different branch
  const switchBranch = useCallback(
    async (branchId: string): Promise<boolean> => {
      if (!threadId) {
        return false;
      }

      // Optimistically update
      const previousBranchId = currentBranchId;
      setCurrentBranchId(branchId);

      try {
        // Remove any duplicate /api/chatkit segments in the URL
        let baseUrl = api.url;
        while (baseUrl.includes('/api/chatkit/api/chatkit')) {
          baseUrl = baseUrl.replace('/api/chatkit/api/chatkit', '/api/chatkit');
        }
        const response = await fetch(
          `${baseUrl}/threads/${threadId}/branches/${branchId}/switch`,
          {
            method: 'POST',
            headers: {
              ...api.headers,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          // Revert on error
          setCurrentBranchId(previousBranchId);
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.detail?.error || `Failed to switch branch: ${response.status}`
          );
        }

        onLog?.({
          name: 'branches.switched',
          data: { from: previousBranchId, to: branchId },
        });

        onBranchChange?.(branchId);

        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.({ error });
        return false;
      }
    },
    [threadId, currentBranchId, api.url, api.headers, onError, onLog, onBranchChange]
  );

  // Compute whether we can create a new branch
  const canCreateBranch = maxBranches === 0 || branches.length < maxBranches;

  return {
    branches,
    currentBranchId,
    isBranchesLoaded,
    maxBranches,
    canCreateBranch,
    isLoadingBranches,
    createBranch,
    switchBranch,
    reloadBranches: loadBranches,
  };
}
