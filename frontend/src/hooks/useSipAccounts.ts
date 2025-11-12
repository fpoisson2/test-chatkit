import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  sipAccountsApi,
  type SipAccount,
  type SipAccountPayload,
  type SipAccountUpdatePayload
} from "../utils/backend";

// Query keys for cache management
export const sipAccountsKeys = {
  all: ["sipAccounts"] as const,
  lists: () => [...sipAccountsKeys.all, "list"] as const,
  list: (token: string | null) => [...sipAccountsKeys.lists(), token] as const,
};

/**
 * Hook to fetch all SIP accounts
 */
export const useSipAccounts = (token: string | null) => {
  return useQuery({
    queryKey: sipAccountsKeys.list(token),
    queryFn: () => sipAccountsApi.list(token),
    enabled: !!token,
  });
};

/**
 * Hook to create a new SIP account
 */
export const useCreateSipAccount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: SipAccountPayload }) =>
      sipAccountsApi.create(token, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: sipAccountsKeys.lists() });

      // Snapshot previous values
      const previousAccounts = queryClient.getQueryData<SipAccount[]>(sipAccountsKeys.list(variables.token));

      // Optimistically update cache with temporary account
      const tempAccount: SipAccount = {
        ...variables.payload,
        id: -1, // Temporary ID
        username: variables.payload.username ?? null,
        password: variables.payload.password ?? null,
        contact_host: variables.payload.contact_host ?? null,
        contact_port: variables.payload.contact_port ?? null,
        contact_transport: variables.payload.contact_transport ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<SipAccount[]>(
        sipAccountsKeys.list(variables.token),
        (old = []) => [...old, tempAccount]
      );

      return { previousAccounts };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousAccounts) {
        queryClient.setQueryData(sipAccountsKeys.list(variables.token), context.previousAccounts);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: sipAccountsKeys.lists() });
    },
  });
};

/**
 * Hook to update a SIP account
 */
export const useUpdateSipAccount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      payload
    }: {
      token: string | null;
      id: number;
      payload: SipAccountUpdatePayload
    }) => sipAccountsApi.update(token, id, payload),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: sipAccountsKeys.lists() });

      // Snapshot previous values
      const previousAccounts = queryClient.getQueryData<SipAccount[]>(sipAccountsKeys.list(variables.token));

      // Optimistically update cache
      const updateFn = (old: SipAccount[] = []) =>
        old.map((account) =>
          account.id === variables.id
            ? { ...account, ...variables.payload, updated_at: new Date().toISOString() }
            : account
        );

      queryClient.setQueryData<SipAccount[]>(sipAccountsKeys.list(variables.token), updateFn);

      return { previousAccounts };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousAccounts) {
        queryClient.setQueryData(sipAccountsKeys.list(variables.token), context.previousAccounts);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: sipAccountsKeys.lists() });
    },
  });
};

/**
 * Hook to delete a SIP account
 */
export const useDeleteSipAccount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, id }: { token: string | null; id: number }) =>
      sipAccountsApi.delete(token, id),
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: sipAccountsKeys.lists() });

      // Snapshot previous values
      const previousAccounts = queryClient.getQueryData<SipAccount[]>(sipAccountsKeys.list(variables.token));

      // Optimistically remove from cache
      const deleteFn = (old: SipAccount[] = []) =>
        old.filter((account) => account.id !== variables.id);

      queryClient.setQueryData<SipAccount[]>(sipAccountsKeys.list(variables.token), deleteFn);

      return { previousAccounts };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousAccounts) {
        queryClient.setQueryData(sipAccountsKeys.list(variables.token), context.previousAccounts);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: sipAccountsKeys.lists() });
    },
  });
};
