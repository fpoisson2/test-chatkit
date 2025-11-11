import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  modelRegistryApi,
  type AvailableModel,
  type AvailableModelPayload,
  type AvailableModelUpdatePayload
} from "../utils/backend";

// Query keys for cache management
export const modelsKeys = {
  all: ["models"] as const,
  lists: () => [...modelsKeys.all, "list"] as const,
  list: (token: string | null) => [...modelsKeys.lists(), token] as const,
  adminList: (token: string | null) => [...modelsKeys.lists(), "admin", token] as const,
};

/**
 * Hook to fetch all models (public API)
 */
export const useModels = (token: string | null) => {
  return useQuery({
    queryKey: modelsKeys.list(token),
    queryFn: () => modelRegistryApi.list(token),
    enabled: !!token,
  });
};

/**
 * Hook to fetch all models (admin API)
 */
export const useModelsAdmin = (token: string | null) => {
  return useQuery({
    queryKey: modelsKeys.adminList(token),
    queryFn: () => modelRegistryApi.listAdmin(token),
    enabled: !!token,
  });
};

/**
 * Hook to create a new model
 */
export const useCreateModel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: AvailableModelPayload }) =>
      modelRegistryApi.create(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: modelsKeys.lists() });

      // Snapshot previous values
      const previousModels = queryClient.getQueryData<AvailableModel[]>(modelsKeys.list(variables.token));
      const previousAdminModels = queryClient.getQueryData<AvailableModel[]>(modelsKeys.adminList(variables.token));

      // Optimistically update cache with temporary model
      const tempModel: AvailableModel = {
        ...variables.payload,
        id: -1, // Temporary ID
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<AvailableModel[]>(
        modelsKeys.list(variables.token),
        (old = []) => [...old, tempModel]
      );

      queryClient.setQueryData<AvailableModel[]>(
        modelsKeys.adminList(variables.token),
        (old = []) => [...old, tempModel]
      );

      return { previousModels, previousAdminModels };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousModels) {
        queryClient.setQueryData(modelsKeys.list(variables.token), context.previousModels);
      }
      if (context?.previousAdminModels) {
        queryClient.setQueryData(modelsKeys.adminList(variables.token), context.previousAdminModels);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: modelsKeys.lists() });
    },
  });
};

/**
 * Hook to update a model
 */
export const useUpdateModel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      payload
    }: {
      token: string | null;
      id: number;
      payload: AvailableModelUpdatePayload
    }) => modelRegistryApi.update(token, id, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: modelsKeys.lists() });

      // Snapshot previous values
      const previousModels = queryClient.getQueryData<AvailableModel[]>(modelsKeys.list(variables.token));
      const previousAdminModels = queryClient.getQueryData<AvailableModel[]>(modelsKeys.adminList(variables.token));

      // Optimistically update cache
      const updateFn = (old: AvailableModel[] = []) =>
        old.map((model) =>
          model.id === variables.id
            ? { ...model, ...variables.payload, updated_at: new Date().toISOString() }
            : model
        );

      queryClient.setQueryData<AvailableModel[]>(modelsKeys.list(variables.token), updateFn);
      queryClient.setQueryData<AvailableModel[]>(modelsKeys.adminList(variables.token), updateFn);

      return { previousModels, previousAdminModels };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousModels) {
        queryClient.setQueryData(modelsKeys.list(variables.token), context.previousModels);
      }
      if (context?.previousAdminModels) {
        queryClient.setQueryData(modelsKeys.adminList(variables.token), context.previousAdminModels);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: modelsKeys.lists() });
    },
  });
};

/**
 * Hook to delete a model
 */
export const useDeleteModel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, id }: { token: string | null; id: number }) =>
      modelRegistryApi.delete(token, id),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: modelsKeys.lists() });

      // Snapshot previous values
      const previousModels = queryClient.getQueryData<AvailableModel[]>(modelsKeys.list(variables.token));
      const previousAdminModels = queryClient.getQueryData<AvailableModel[]>(modelsKeys.adminList(variables.token));

      // Optimistically remove from cache
      const deleteFn = (old: AvailableModel[] = []) =>
        old.filter((model) => model.id !== variables.id);

      queryClient.setQueryData<AvailableModel[]>(modelsKeys.list(variables.token), deleteFn);
      queryClient.setQueryData<AvailableModel[]>(modelsKeys.adminList(variables.token), deleteFn);

      return { previousModels, previousAdminModels };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousModels) {
        queryClient.setQueryData(modelsKeys.list(variables.token), context.previousModels);
      }
      if (context?.previousAdminModels) {
        queryClient.setQueryData(modelsKeys.adminList(variables.token), context.previousAdminModels);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: modelsKeys.lists() });
    },
  });
};
