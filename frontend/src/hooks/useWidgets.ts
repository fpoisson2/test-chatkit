import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  widgetLibraryApi,
  type WidgetTemplate,
  type WidgetTemplateCreatePayload,
  type WidgetTemplateUpdatePayload,
  type WidgetTemplateSummary,
} from "../utils/backend";

// Query keys for cache management
export const widgetsKeys = {
  all: ["widgets"] as const,
  lists: () => [...widgetsKeys.all, "list"] as const,
  list: (token: string | null) => [...widgetsKeys.lists(), token] as const,
  workflowWidgets: (token: string | null) => [...widgetsKeys.all, "workflow", token] as const,
  details: () => [...widgetsKeys.all, "detail"] as const,
  detail: (slug: string) => [...widgetsKeys.details(), slug] as const,
};

/**
 * Hook to fetch all widgets
 */
export const useWidgets = (token: string | null) => {
  return useQuery({
    queryKey: widgetsKeys.list(token),
    queryFn: () => widgetLibraryApi.listWidgets(token),
    enabled: !!token,
  });
};

/**
 * Hook to fetch workflow widgets
 */
export const useWorkflowWidgets = (token: string | null) => {
  return useQuery({
    queryKey: widgetsKeys.workflowWidgets(token),
    queryFn: () => widgetLibraryApi.listWorkflowWidgets(token),
    enabled: !!token,
  });
};

/**
 * Hook to fetch a single widget
 */
export const useWidget = (token: string | null, slug: string) => {
  return useQuery({
    queryKey: widgetsKeys.detail(slug),
    queryFn: () => widgetLibraryApi.getWidget(token, slug),
    enabled: !!token && !!slug,
  });
};

/**
 * Hook to create a new widget
 */
export const useCreateWidget = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, payload }: { token: string | null; payload: WidgetTemplateCreatePayload }) =>
      widgetLibraryApi.createWidget(token, payload),
    onSuccess: (newWidget, variables) => {
      // Add the new widget to the cache
      queryClient.setQueryData<WidgetTemplate[]>(
        widgetsKeys.list(variables.token),
        (oldWidgets) => [...(oldWidgets || []), newWidget]
      );
    },
  });
};

/**
 * Hook to update a widget
 */
export const useUpdateWidget = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      token,
      slug,
      payload
    }: {
      token: string | null;
      slug: string;
      payload: WidgetTemplateUpdatePayload
    }) => widgetLibraryApi.updateWidget(token, slug, payload),
    onSuccess: (updatedWidget, variables) => {
      // Update the widget in the cache
      queryClient.setQueryData<WidgetTemplate[]>(
        widgetsKeys.list(variables.token),
        (oldWidgets) =>
          oldWidgets?.map((widget) =>
            widget.slug === variables.slug ? updatedWidget : widget
          ) || []
      );
      // Update the detail cache
      queryClient.setQueryData<WidgetTemplate>(
        widgetsKeys.detail(variables.slug),
        updatedWidget
      );
    },
  });
};

/**
 * Hook to delete a widget
 */
export const useDeleteWidget = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ token, slug }: { token: string | null; slug: string }) =>
      widgetLibraryApi.deleteWidget(token, slug),
    onSuccess: (_, variables) => {
      // Remove the widget from the cache
      queryClient.setQueryData<WidgetTemplate[]>(
        widgetsKeys.list(variables.token),
        (oldWidgets) => oldWidgets?.filter((widget) => widget.slug !== variables.slug) || []
      );
      // Remove from detail cache
      queryClient.removeQueries({ queryKey: widgetsKeys.detail(variables.slug) });
    },
  });
};

/**
 * Hook to preview a widget
 */
export const usePreviewWidget = () => {
  return useMutation({
    mutationFn: ({ token, definition }: { token: string | null; definition: Record<string, unknown> }) =>
      widgetLibraryApi.previewWidget(token, definition),
  });
};
