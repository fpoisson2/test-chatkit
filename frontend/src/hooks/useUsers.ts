import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type EditableUser, type CreateUserPayload } from "../utils/backend";

// Query keys for cache management
export const usersKeys = {
  all: ["users"] as const,
  lists: () => [...usersKeys.all, "list"] as const,
  list: (token: string | null) => [...usersKeys.lists(), token] as const,
  details: () => [...usersKeys.all, "detail"] as const,
  detail: (id: number) => [...usersKeys.details(), id] as const,
};

/**
 * Hook to fetch all users
 */
export const useUsers = (token: string | null) => {
  return useQuery({
    queryKey: usersKeys.list(token),
    queryFn: () => adminApi.listUsers(token),
    enabled: !!token,
  });
};

/**
 * Hook to create a new user
 */
export const useCreateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: CreateUserPayload }) =>
      adminApi.createUser(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() });

      // Snapshot previous value
      const previousUsers = queryClient.getQueryData<EditableUser[]>(usersKeys.list(variables.token));

      // Optimistically update cache with temporary user
      const tempUser: EditableUser = {
        ...variables.payload,
        id: -1, // Temporary ID
      };

      queryClient.setQueryData<EditableUser[]>(
        usersKeys.list(variables.token),
        (old = []) => [...old, tempUser]
      );

      return { previousUsers };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousUsers) {
        queryClient.setQueryData(usersKeys.list(variables.token), context.previousUsers);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
    },
  });
};

/**
 * Hook to update a user
 */
export const useUpdateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      payload
    }: {
      token: string | null;
      id: number;
      payload: Partial<CreateUserPayload>
    }) => adminApi.updateUser(token, id, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() });

      // Snapshot previous value
      const previousUsers = queryClient.getQueryData<EditableUser[]>(usersKeys.list(variables.token));

      // Optimistically update cache
      queryClient.setQueryData<EditableUser[]>(
        usersKeys.list(variables.token),
        (old = []) =>
          old.map((user) => (user.id === variables.id ? { ...user, ...variables.payload } : user))
      );

      return { previousUsers };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousUsers) {
        queryClient.setQueryData(usersKeys.list(variables.token), context.previousUsers);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
    },
  });
};

/**
 * Hook to delete a user
 */
export const useDeleteUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, id }: { token: string | null; id: number }) =>
      adminApi.deleteUser(token, id),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() });

      // Snapshot previous value
      const previousUsers = queryClient.getQueryData<EditableUser[]>(usersKeys.list(variables.token));

      // Optimistically remove from cache
      queryClient.setQueryData<EditableUser[]>(
        usersKeys.list(variables.token),
        (old = []) => old.filter((user) => user.id !== variables.id)
      );

      return { previousUsers };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousUsers) {
        queryClient.setQueryData(usersKeys.list(variables.token), context.previousUsers);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() });
    },
  });
};
