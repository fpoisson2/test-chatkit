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
    onSuccess: (newUser, variables) => {
      // Add the new user to the cache
      queryClient.setQueryData<EditableUser[]>(
        usersKeys.list(variables.token),
        (oldUsers) => [...(oldUsers || []), newUser]
      );
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
    onSuccess: (updatedUser, variables) => {
      // Update the user in the cache
      queryClient.setQueryData<EditableUser[]>(
        usersKeys.list(variables.token),
        (oldUsers) =>
          oldUsers?.map((user) => (user.id === variables.id ? updatedUser : user)) || []
      );
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
    onSuccess: (_, variables) => {
      // Remove the user from the cache
      queryClient.setQueryData<EditableUser[]>(
        usersKeys.list(variables.token),
        (oldUsers) => oldUsers?.filter((user) => user.id !== variables.id) || []
      );
    },
  });
};
