import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type WorkflowGenerationPrompt = {
  id: number;
  name: string;
  model: string;
  effort: "low" | "medium" | "high";
  verbosity: "low" | "medium" | "high";
  developer_message: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowGenerationPromptPayload = {
  name: string;
  model: string;
  effort: "low" | "medium" | "high";
  verbosity: "low" | "medium" | "high";
  developer_message: string;
};

export type WorkflowGenerationTask = {
  task_id: string;
  workflow_id: number;
  prompt_id: number | null;
  user_message: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  error_message: string | null;
  result_json: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
};

export type WorkflowGenerationStartResponse = {
  task_id: string;
  status: string;
  message: string;
};

const API_BASE = "/api";

const promptsApi = {
  list: async (token: string | null): Promise<WorkflowGenerationPrompt[]> => {
    const response = await fetch(`${API_BASE}/admin/workflow-generation-prompts`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error("Failed to fetch workflow generation prompts");
    }
    return response.json();
  },

  create: async (
    token: string | null,
    payload: WorkflowGenerationPromptPayload
  ): Promise<WorkflowGenerationPrompt> => {
    const response = await fetch(`${API_BASE}/admin/workflow-generation-prompts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to create workflow generation prompt");
    }
    return response.json();
  },

  update: async (
    token: string | null,
    id: number,
    payload: Partial<WorkflowGenerationPromptPayload>
  ): Promise<WorkflowGenerationPrompt> => {
    const response = await fetch(`${API_BASE}/admin/workflow-generation-prompts/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to update workflow generation prompt");
    }
    return response.json();
  },

  delete: async (token: string | null, id: number): Promise<void> => {
    const response = await fetch(`${API_BASE}/admin/workflow-generation-prompts/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error("Failed to delete workflow generation prompt");
    }
  },
};

const generationApi = {
  listPrompts: async (token: string | null): Promise<WorkflowGenerationPrompt[]> => {
    const response = await fetch(`${API_BASE}/workflows/generation/prompts`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error("Failed to fetch workflow generation prompts");
    }
    return response.json();
  },

  startGeneration: async (
    token: string | null,
    workflowId: number,
    promptId: number,
    userMessage: string
  ): Promise<WorkflowGenerationStartResponse> => {
    const response = await fetch(`${API_BASE}/workflows/${workflowId}/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt_id: promptId,
        user_message: userMessage,
      }),
    });
    if (!response.ok) {
      throw new Error("Failed to start workflow generation");
    }
    return response.json();
  },

  getTaskStatus: async (
    token: string | null,
    taskId: string
  ): Promise<WorkflowGenerationTask> => {
    const response = await fetch(`${API_BASE}/workflows/generation/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error("Failed to get task status");
    }
    return response.json();
  },

  applyGeneration: async (
    token: string | null,
    workflowId: number,
    taskId: string
  ): Promise<unknown> => {
    const response = await fetch(
      `${API_BASE}/workflows/${workflowId}/generation/apply?task_id=${taskId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!response.ok) {
      throw new Error("Failed to apply generated workflow");
    }
    return response.json();
  },
};

// Query keys
const promptsKeys = {
  all: ["workflow-generation-prompts"] as const,
  list: (token: string | null) => [...promptsKeys.all, "list", token] as const,
};

const generationKeys = {
  all: ["workflow-generation"] as const,
  prompts: (token: string | null) => [...generationKeys.all, "prompts", token] as const,
  task: (token: string | null, taskId: string) =>
    [...generationKeys.all, "task", token, taskId] as const,
};

// Admin hooks for managing prompts
export const useWorkflowGenerationPrompts = (token: string | null) => {
  return useQuery({
    queryKey: promptsKeys.list(token),
    queryFn: () => promptsApi.list(token),
    enabled: !!token,
  });
};

export const useCreateWorkflowGenerationPrompt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      payload,
    }: {
      token: string | null;
      payload: WorkflowGenerationPromptPayload;
    }) => promptsApi.create(token, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: promptsKeys.list(variables.token) });
      queryClient.invalidateQueries({ queryKey: generationKeys.prompts(variables.token) });
    },
  });
};

export const useUpdateWorkflowGenerationPrompt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      id,
      payload,
    }: {
      token: string | null;
      id: number;
      payload: Partial<WorkflowGenerationPromptPayload>;
    }) => promptsApi.update(token, id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: promptsKeys.list(variables.token) });
      queryClient.invalidateQueries({ queryKey: generationKeys.prompts(variables.token) });
    },
  });
};

export const useDeleteWorkflowGenerationPrompt = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, id }: { token: string | null; id: number }) =>
      promptsApi.delete(token, id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: promptsKeys.list(variables.token) });
      queryClient.invalidateQueries({ queryKey: generationKeys.prompts(variables.token) });
    },
  });
};

// Hooks for workflow generation in the builder
export const useGenerationPrompts = (token: string | null) => {
  return useQuery({
    queryKey: generationKeys.prompts(token),
    queryFn: () => generationApi.listPrompts(token),
    enabled: !!token,
  });
};

export const useStartWorkflowGeneration = () => {
  return useMutation({
    mutationFn: ({
      token,
      workflowId,
      promptId,
      userMessage,
    }: {
      token: string | null;
      workflowId: number;
      promptId: number;
      userMessage: string;
    }) => generationApi.startGeneration(token, workflowId, promptId, userMessage),
  });
};

export const useGenerationTaskStatus = (
  token: string | null,
  taskId: string | null,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: generationKeys.task(token, taskId ?? ""),
    queryFn: () => generationApi.getTaskStatus(token, taskId!),
    enabled: !!token && !!taskId && enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "completed" || data.status === "failed")) {
        return false;
      }
      return 2000; // Poll every 2 seconds while running
    },
  });
};

export const useApplyWorkflowGeneration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      workflowId,
      taskId,
    }: {
      token: string | null;
      workflowId: number;
      taskId: string;
    }) => generationApi.applyGeneration(token, workflowId, taskId),
    onSuccess: () => {
      // Invalidate workflow queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};
