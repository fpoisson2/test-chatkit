import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Thread, ChatKitAPIConfig } from "../chatkit/types";
import { listThreads } from "../chatkit/api/streaming/api";

const PAGE_SIZE = 20;

export const threadsKeys = {
  all: ["threads"] as const,
  list: (url: string | null) => [...threadsKeys.all, "list", url] as const,
};

interface ThreadsPage {
  threads: Thread[];
  nextCursor: string | undefined;
}

export function useThreads(api: ChatKitAPIConfig | null) {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery<ThreadsPage>({
    queryKey: threadsKeys.list(api?.url ?? null),
    queryFn: async ({ pageParam }) => {
      const response = await listThreads({
        url: api!.url,
        headers: api!.headers,
        limit: PAGE_SIZE,
        order: "desc",
        after: pageParam as string | undefined,
        allWorkflows: true,
      });
      const threads = response.data || [];
      return {
        threads,
        nextCursor: threads.length === PAGE_SIZE ? threads[threads.length - 1].id : undefined,
      };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!api,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const allThreads: Thread[] = query.data?.pages.flatMap((p) => p.threads) ?? [];

  const updateThread = useCallback(
    (threadId: string, updater: (thread: Thread) => Thread) => {
      queryClient.setQueryData(
        threadsKeys.list(api?.url ?? null),
        (old: typeof query.data) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              threads: page.threads.map((t) =>
                t.id === threadId ? updater(t) : t
              ),
            })),
          };
        }
      );
    },
    [queryClient, api?.url, query.data]
  );

  const addThread = useCallback(
    (thread: Thread) => {
      queryClient.setQueryData(
        threadsKeys.list(api?.url ?? null),
        (old: typeof query.data) => {
          if (!old) return old;
          // Don't add if already exists
          const exists = old.pages.some((p) => p.threads.some((t) => t.id === thread.id));
          if (exists) return old;
          const pages = [...old.pages];
          pages[0] = { ...pages[0], threads: [thread, ...pages[0].threads] };
          return { ...old, pages };
        }
      );
    },
    [queryClient, api?.url, query.data]
  );

  const removeThread = useCallback(
    (threadId: string) => {
      queryClient.setQueryData(
        threadsKeys.list(api?.url ?? null),
        (old: typeof query.data) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              threads: page.threads.filter((t) => t.id !== threadId),
            })),
          };
        }
      );
    },
    [queryClient, api?.url, query.data]
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: threadsKeys.list(api?.url ?? null) });
  }, [queryClient, api?.url]);

  const reset = useCallback(() => {
    queryClient.resetQueries({ queryKey: threadsKeys.list(api?.url ?? null) });
  }, [queryClient, api?.url]);

  return {
    threads: allThreads,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    error: query.error ? "Impossible de charger les conversations" : null,
    hasMore: query.hasNextPage ?? false,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    updateThread,
    addThread,
    removeThread,
    invalidate,
    reset,
  };
}
