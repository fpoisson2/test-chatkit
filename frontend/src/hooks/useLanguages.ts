import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "../utils/backend";

// Types
type Language = {
  code: string;
  name: string;
  translationFile: string;
  keysCount: number;
  totalKeys: number;
  fileExists: boolean;
};

type AvailableModel = {
  id: number;
  name: string;
  provider_id: string | null;
  provider_slug: string | null;
};

type TaskStatus = {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  language_id: number | null;
  can_download: boolean;
};

type StoredLanguage = {
  id: number;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type GenerateLanguagePayload = {
  code: string;
  name: string;
  model?: string;
  provider_id?: string;
  provider_slug?: string;
  custom_prompt?: string;
  save_to_db: boolean;
};

// Query keys for cache management
export const languagesKeys = {
  all: ["languages"] as const,
  list: () => [...languagesKeys.all, "list"] as const,
  models: () => [...languagesKeys.all, "models"] as const,
  defaultPrompt: () => [...languagesKeys.all, "defaultPrompt"] as const,
  stored: () => [...languagesKeys.all, "stored"] as const,
  task: (taskId: string) => [...languagesKeys.all, "task", taskId] as const,
};

/**
 * Hook to fetch languages list
 */
export const useLanguages = (token: string | null) => {
  return useQuery({
    queryKey: languagesKeys.list(),
    queryFn: async () => {
      if (!token) throw new Error("No token");

      const response = await fetch("/api/admin/languages", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          throw new Error("Unauthorized");
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return (data.languages || []) as Language[];
    },
    enabled: !!token,
  });
};

/**
 * Hook to fetch available models
 */
export const useAvailableModels = (token: string | null) => {
  return useQuery({
    queryKey: languagesKeys.models(),
    queryFn: async () => {
      if (!token) throw new Error("No token");

      const response = await fetch("/api/admin/languages/models", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          throw new Error("Unauthorized");
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return (data.models || []) as AvailableModel[];
    },
    enabled: !!token,
  });
};

/**
 * Hook to fetch default prompt
 */
export const useDefaultPrompt = (token: string | null) => {
  return useQuery({
    queryKey: languagesKeys.defaultPrompt(),
    queryFn: async () => {
      if (!token) throw new Error("No token");

      const response = await fetch("/api/admin/languages/default-prompt", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          throw new Error("Unauthorized");
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return (data.prompt || "") as string;
    },
    enabled: !!token,
  });
};

/**
 * Hook to fetch stored languages
 */
export const useStoredLanguages = (token: string | null) => {
  return useQuery({
    queryKey: languagesKeys.stored(),
    queryFn: async () => {
      if (!token) throw new Error("No token");

      const response = await fetch("/api/admin/languages/stored", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          throw new Error("Unauthorized");
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return (data.languages || []) as StoredLanguage[];
    },
    enabled: !!token,
  });
};

/**
 * Hook to fetch task status
 */
export const useTaskStatus = (token: string | null, taskId: string | null) => {
  return useQuery({
    queryKey: languagesKeys.task(taskId ?? ""),
    queryFn: async () => {
      if (!token || !taskId) throw new Error("No token or taskId");

      const response = await fetch(`/api/admin/languages/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          throw new Error("Unauthorized");
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return (await response.json()) as TaskStatus;
    },
    enabled: !!token && !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling if task is completed or failed
      if (status === "completed" || status === "failed") {
        return false;
      }
      // Poll every 2 seconds
      return 2000;
    },
  });
};

/**
 * Hook to generate a new language
 */
export const useGenerateLanguage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      token,
      payload,
    }: {
      token: string | null;
      payload: GenerateLanguagePayload;
    }) => {
      if (!token) throw new Error("No token");

      const response = await fetch("/api/admin/languages/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (isUnauthorizedError(response.status)) {
          throw new Error("Unauthorized");
        }

        const errorData = await response.json().catch(() => ({}));
        if (errorData.detail?.includes("already exist")) {
          throw new Error("Language code already exists");
        }
        throw new Error("Failed to generate language");
      }

      return (await response.json()) as { task_id: string };
    },
  });
};

/**
 * Hook to delete a stored language
 */
export const useDeleteStoredLanguage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, id }: { token: string | null; id: number }) => {
      if (!token) throw new Error("No token");

      const response = await fetch(`/api/admin/languages/stored/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    },
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: languagesKeys.stored() });

      // Snapshot previous value
      const previousLanguages = queryClient.getQueryData<StoredLanguage[]>(languagesKeys.stored());

      // Optimistically remove from cache
      queryClient.setQueryData<StoredLanguage[]>(
        languagesKeys.stored(),
        (old = []) => old.filter((lang) => lang.id !== variables.id)
      );

      return { previousLanguages };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousLanguages) {
        queryClient.setQueryData(languagesKeys.stored(), context.previousLanguages);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: languagesKeys.stored() });
    },
  });
};

/**
 * Hook to activate a stored language
 */
export const useActivateStoredLanguage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, id }: { token: string | null; id: number }) => {
      if (!token) throw new Error("No token");

      const response = await fetch(`/api/admin/languages/stored/${id}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return (await response.json()) as { message: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: languagesKeys.list() });
      queryClient.invalidateQueries({ queryKey: languagesKeys.stored() });
    },
  });
};

/**
 * Helper function to download task result
 */
export const downloadTaskResult = async (token: string | null, taskId: string) => {
  if (!token) throw new Error("No token");

  const response = await fetch(`/api/admin/languages/tasks/${taskId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const contentDisposition = response.headers.get("Content-Disposition");
  const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || "translation.ts";
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};

/**
 * Helper function to download stored language
 */
export const downloadStoredLanguage = async (token: string | null, id: number) => {
  if (!token) throw new Error("No token");

  const response = await fetch(`/api/admin/languages/stored/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const contentDisposition = response.headers.get("Content-Disposition");
  const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || "translation.ts";
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};
