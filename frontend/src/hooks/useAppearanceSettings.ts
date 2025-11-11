import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  appearanceSettingsApi,
  type AppearanceSettings,
  type AppearanceSettingsUpdatePayload,
  type WorkflowAppearance,
  type WorkflowAppearanceUpdatePayload
} from "../utils/backend";

// Query keys for cache management
export const appearanceSettingsKeys = {
  all: ["appearanceSettings"] as const,
  detail: (scope?: "admin" | "public", workflowId?: number | string | null) =>
    [...appearanceSettingsKeys.all, "detail", scope, workflowId] as const,
  workflow: (reference: number | string) =>
    [...appearanceSettingsKeys.all, "workflow", reference] as const,
};

/**
 * Hook to fetch appearance settings
 */
export const useAppearanceSettings = (
  token: string | null,
  options?: { scope?: "admin" | "public"; workflowId?: number | string | null }
) => {
  return useQuery({
    queryKey: appearanceSettingsKeys.detail(options?.scope, options?.workflowId),
    queryFn: () => appearanceSettingsApi.get(token, options),
    enabled: options?.scope === "public" || !!token,
  });
};

/**
 * Hook to update appearance settings
 */
export const useUpdateAppearanceSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      payload
    }: {
      token: string | null;
      payload: AppearanceSettingsUpdatePayload
    }) => appearanceSettingsApi.update(token, payload),
    onSuccess: (data, variables) => {
      // Update the cache with the new data
      queryClient.setQueryData<AppearanceSettings>(
        appearanceSettingsKeys.detail("admin"),
        data
      );
      // Invalidate all appearance settings to ensure consistency
      queryClient.invalidateQueries({ queryKey: appearanceSettingsKeys.all });
    },
  });
};

/**
 * Hook to fetch workflow-specific appearance settings
 */
export const useWorkflowAppearance = (token: string | null, reference: number | string) => {
  return useQuery({
    queryKey: appearanceSettingsKeys.workflow(reference),
    queryFn: () => appearanceSettingsApi.getForWorkflow(token, reference),
    enabled: !!token,
  });
};

/**
 * Hook to update workflow-specific appearance settings
 */
export const useUpdateWorkflowAppearance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      reference,
      payload
    }: {
      token: string | null;
      reference: number | string;
      payload: WorkflowAppearanceUpdatePayload
    }) => appearanceSettingsApi.updateForWorkflow(token, reference, payload),
    onSuccess: (data, variables) => {
      // Update the cache with the new data
      queryClient.setQueryData<WorkflowAppearance>(
        appearanceSettingsKeys.workflow(variables.reference),
        data
      );
    },
  });
};
