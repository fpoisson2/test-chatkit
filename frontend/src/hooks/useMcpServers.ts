import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  mcpServersApi,
  type McpServerSummary,
  type McpServerPayload,
  type McpServerProbeRequest,
  type McpTestConnectionResponse
} from "../utils/backend";

// Query keys for cache management
export const mcpServersKeys = {
  all: ["mcpServers"] as const,
  lists: () => [...mcpServersKeys.all, "list"] as const,
  list: (token: string | null) => [...mcpServersKeys.lists(), token] as const,
};

/**
 * Hook to fetch all MCP servers
 */
export const useMcpServers = (token: string | null) => {
  return useQuery({
    queryKey: mcpServersKeys.list(token),
    queryFn: () => mcpServersApi.list(token),
    enabled: !!token,
  });
};

/**
 * Hook to create a new MCP server
 */
export const useCreateMcpServer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: McpServerPayload }) =>
      mcpServersApi.create(token, payload),
    onSuccess: (newServer, variables) => {
      // Add the new server to the cache
      queryClient.setQueryData<McpServerSummary[]>(
        mcpServersKeys.list(variables.token),
        (oldServers) => [...(oldServers || []), newServer]
      );
    },
  });
};

/**
 * Hook to update an MCP server
 */
export const useUpdateMcpServer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      serverId,
      payload
    }: {
      token: string | null;
      serverId: number;
      payload: McpServerPayload
    }) => mcpServersApi.update(token, serverId, payload),
    onSuccess: (updatedServer, variables) => {
      // Update the server in the cache
      queryClient.setQueryData<McpServerSummary[]>(
        mcpServersKeys.list(variables.token),
        (oldServers) =>
          oldServers?.map((server) =>
            server.id === variables.serverId ? updatedServer : server
          ) || []
      );
    },
  });
};

/**
 * Hook to delete an MCP server
 */
export const useDeleteMcpServer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, serverId }: { token: string | null; serverId: number }) =>
      mcpServersApi.delete(token, serverId),
    onSuccess: (_, variables) => {
      // Remove the server from the cache
      queryClient.setQueryData<McpServerSummary[]>(
        mcpServersKeys.list(variables.token),
        (oldServers) => oldServers?.filter((server) => server.id !== variables.serverId) || []
      );
    },
  });
};

/**
 * Hook to probe an MCP server connection
 * This is a mutation because it performs a connection test
 */
export const useProbeMcpServer = () => {
  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: McpServerProbeRequest }) =>
      mcpServersApi.probe(token, payload),
  });
};
