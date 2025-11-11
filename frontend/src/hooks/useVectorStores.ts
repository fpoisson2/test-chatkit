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
    onSuccess: (newStore, variables) => {
      // Add the new store to the cache
      queryClient.setQueryData<VectorStoreSummary[]>(
        vectorStoresKeys.list(variables.token),
        (oldStores) => [...(oldStores || []), newStore]
      );
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
    onSuccess: (_, variables) => {
      // Remove the store from the cache
      queryClient.setQueryData<VectorStoreSummary[]>(
        vectorStoresKeys.list(variables.token),
        (oldStores) => oldStores?.filter((store) => store.slug !== variables.slug) || []
      );
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
    onSuccess: (_, variables) => {
      // Invalidate documents list to refetch
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
