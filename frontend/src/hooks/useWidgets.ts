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
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: widgetsKeys.lists() });

      // Snapshot previous value
      const previousWidgets = queryClient.getQueryData<WidgetTemplate[]>(widgetsKeys.list(variables.token));

      // Optimistically update cache with temporary widget
      const tempWidget: WidgetTemplate = {
        ...variables.payload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as WidgetTemplate;

      queryClient.setQueryData<WidgetTemplate[]>(
        widgetsKeys.list(variables.token),
        (old = []) => [...old, tempWidget]
      );

      return { previousWidgets };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWidgets) {
        queryClient.setQueryData(widgetsKeys.list(variables.token), context.previousWidgets);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: widgetsKeys.lists() });
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
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: widgetsKeys.lists() });
      await queryClient.cancelQueries({ queryKey: widgetsKeys.detail(variables.slug) });

      // Snapshot previous values
      const previousWidgets = queryClient.getQueryData<WidgetTemplate[]>(widgetsKeys.list(variables.token));
      const previousDetail = queryClient.getQueryData<WidgetTemplate>(widgetsKeys.detail(variables.slug));

      // Optimistically update cache
      queryClient.setQueryData<WidgetTemplate[]>(
        widgetsKeys.list(variables.token),
        (old = []) =>
          old.map((widget) =>
            widget.slug === variables.slug
              ? { ...widget, ...variables.payload, updated_at: new Date().toISOString() }
              : widget
          )
      );

      if (previousDetail) {
        queryClient.setQueryData<WidgetTemplate>(
          widgetsKeys.detail(variables.slug),
          { ...previousDetail, ...variables.payload, updated_at: new Date().toISOString() }
        );
      }

      return { previousWidgets, previousDetail };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWidgets) {
        queryClient.setQueryData(widgetsKeys.list(variables.token), context.previousWidgets);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(widgetsKeys.detail(variables.slug), context.previousDetail);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: widgetsKeys.lists() });
      queryClient.invalidateQueries({ queryKey: widgetsKeys.detail(variables.slug) });
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
    onMutate: async (variables) => {
      // Cancel outgoing queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: widgetsKeys.lists() });
      await queryClient.cancelQueries({ queryKey: widgetsKeys.detail(variables.slug) });

      // Snapshot previous values
      const previousWidgets = queryClient.getQueryData<WidgetTemplate[]>(widgetsKeys.list(variables.token));
      const previousDetail = queryClient.getQueryData<WidgetTemplate>(widgetsKeys.detail(variables.slug));

      // Optimistically remove from cache
      queryClient.setQueryData<WidgetTemplate[]>(
        widgetsKeys.list(variables.token),
        (old = []) => old.filter((widget) => widget.slug !== variables.slug)
      );

      queryClient.removeQueries({ queryKey: widgetsKeys.detail(variables.slug) });

      return { previousWidgets, previousDetail };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousWidgets) {
        queryClient.setQueryData(widgetsKeys.list(variables.token), context.previousWidgets);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(widgetsKeys.detail(variables.slug), context.previousDetail);
      }
    },
    onSettled: (data, error, variables) => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: widgetsKeys.lists() });
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
