import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  vectorStoreApi,
  type VectorStoreSummary,
  type VectorStoreCreatePayload,
  type VectorStoreDocument,
  type VectorStoreIngestionPayload,
  type VectorStoreSearchPayload,
  type VectorStoreSearchResult,
} from "../utils/backend";

// Query keys for cache management
export const vectorStoresKeys = {
  all: ["vectorStores"] as const,
  lists: () => [...vectorStoresKeys.all, "list"] as const,
  list: (token: string | null) => [...vectorStoresKeys.lists(), token] as const,
  documents: (slug: string) => [...vectorStoresKeys.all, "documents", slug] as const,
};

/**
 * Hook to fetch all vector stores
 */
export const useVectorStores = (token: string | null) => {
  return useQuery({
    queryKey: vectorStoresKeys.list(token),
    queryFn: () => vectorStoreApi.listStores(token),
    enabled: !!token,
  });
};

/**
 * Hook to create a new vector store
 */
export const useCreateVectorStore = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: VectorStoreCreatePayload }) =>
      vectorStoreApi.createStore(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: vectorStoresKeys.lists() });

      // Snapshot previous value
      const previousStores = queryClient.getQueryData<VectorStoreSummary[]>(vectorStoresKeys.list(variables.token));

      // Optimistically update cache with temporary store
      const tempStore: VectorStoreSummary = {
        ...variables.payload,
        created_at: new Date().toISOString(),
        num_documents: 0,
      };

      queryClient.setQueryData<VectorStoreSummary[]>(
        vectorStoresKeys.list(variables.token),
        (old = []) => [...old, tempStore]
      );

      return { previousStores };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousStores) {
        queryClient.setQueryData(vectorStoresKeys.list(variables.token), context.previousStores);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: vectorStoresKeys.lists() });
    },
  });
};

/**
 * Hook to delete a vector store
 */
export const useDeleteVectorStore = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, slug }: { token: string | null; slug: string }) =>
      vectorStoreApi.deleteStore(token, slug),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: vectorStoresKeys.lists() });
      await queryClient.cancelQueries({ queryKey: vectorStoresKeys.documents(variables.slug) });

      // Snapshot previous values
      const previousStores = queryClient.getQueryData<VectorStoreSummary[]>(vectorStoresKeys.list(variables.token));

      // Optimistically remove from cache
      queryClient.setQueryData<VectorStoreSummary[]>(
        vectorStoresKeys.list(variables.token),
        (old = []) => old.filter((store) => store.slug !== variables.slug)
      );

      return { previousStores };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousStores) {
        queryClient.setQueryData(vectorStoresKeys.list(variables.token), context.previousStores);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: vectorStoresKeys.lists() });
    },
  });
};

/**
 * Hook to fetch documents in a vector store
 */
export const useVectorStoreDocuments = (token: string | null, slug: string) => {
  return useQuery({
    queryKey: vectorStoresKeys.documents(slug),
    queryFn: () => vectorStoreApi.listDocuments(token, slug),
    enabled: !!token && !!slug,
  });
};

/**
 * Hook to ingest a document into a vector store
 */
export const useIngestDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      slug,
      payload
    }: {
      token: string | null;
      slug: string;
      payload: VectorStoreIngestionPayload
    }) => vectorStoreApi.ingestDocument(token, slug, payload),
    onSuccess: (_, variables) => {
      // Invalidate documents list to refetch
      queryClient.invalidateQueries({ queryKey: vectorStoresKeys.documents(variables.slug) });
    },
  });
};

/**
 * Hook to delete a document from a vector store
 */
export const useDeleteDocument = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      slug,
      docId
    }: {
      token: string | null;
      slug: string;
      docId: string
    }) => vectorStoreApi.deleteDocument(token, slug, docId),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: vectorStoresKeys.documents(variables.slug) });

      // Snapshot previous value
      const previousDocuments = queryClient.getQueryData<VectorStoreDocument[]>(
        vectorStoresKeys.documents(variables.slug)
      );

      // Optimistically remove from cache
      queryClient.setQueryData<VectorStoreDocument[]>(
        vectorStoresKeys.documents(variables.slug),
        (old = []) => old.filter((doc) => doc.id !== variables.docId)
      );

      return { previousDocuments };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousDocuments) {
        queryClient.setQueryData(vectorStoresKeys.documents(variables.slug), context.previousDocuments);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: vectorStoresKeys.documents(variables.slug) });
    },
  });
};

/**
 * Hook to search in a vector store
 */
export const useSearchVectorStore = () => {
  return useMutation({
    mutationFn: ({
      token,
      slug,
      payload
    }: {
      token: string | null;
      slug: string;
      payload: VectorStoreSearchPayload
    }) => vectorStoreApi.search(token, slug, payload),
  });
};
