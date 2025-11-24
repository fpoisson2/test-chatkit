import { useMemo } from "react";

import {
  type AvailableModel,
  type VectorStoreSummary,
  type WidgetTemplateSummary,
} from "../../../utils/backend";
import {
  useVectorStores,
  useModels,
  useWorkflowWidgets,
} from "../../../hooks";
import {
  COMPUTER_USE_WIDGET_DEFAULT_DESCRIPTION,
  COMPUTER_USE_WIDGET_DEFAULT_TITLE,
  COMPUTER_USE_WIDGET_SLUG,
} from "../../../constants/widgets";

type WorkflowResourceState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export type WorkflowResourcesState = {
  vectorStores: WorkflowResourceState<VectorStoreSummary[]>;
  availableModels: WorkflowResourceState<AvailableModel[]>;
  widgets: WorkflowResourceState<WidgetTemplateSummary[]>;
};

/**
 * Hook that provides all resources needed by the workflow builder
 * Migrated to React Query for automatic caching and refetching
 */
const useWorkflowResources = (token: string | null): WorkflowResourcesState => {
  // React Query hooks - automatically handle loading, error, and caching
  const {
    data: vectorStoresData = [],
    isLoading: vectorStoresLoading,
    error: vectorStoresError,
    refetch: refetchVectorStores,
  } = useVectorStores(token);

  const {
    data: availableModelsData = [],
    isLoading: availableModelsLoading,
    error: availableModelsError,
    refetch: refetchAvailableModels,
  } = useModels(token);

  const {
    data: widgetsData = [],
    isLoading: widgetsLoading,
    error: widgetsError,
    refetch: refetchWidgets,
  } = useWorkflowWidgets(token);

  const widgetsWithComputerUse = useMemo(() => {
    const hasComputerUse = widgetsData.some((widget) => widget.slug === COMPUTER_USE_WIDGET_SLUG);

    if (hasComputerUse) {
      return widgetsData;
    }

    const summary: WidgetTemplateSummary = {
      slug: COMPUTER_USE_WIDGET_SLUG,
      title: COMPUTER_USE_WIDGET_DEFAULT_TITLE,
      description: COMPUTER_USE_WIDGET_DEFAULT_DESCRIPTION,
    };

    return [...widgetsData, summary];
  }, [widgetsData]);

  return {
    vectorStores: {
      data: vectorStoresData,
      loading: vectorStoresLoading,
      error: vectorStoresError instanceof Error
        ? vectorStoresError.message
        : vectorStoresError
        ? "Impossible de charger les vector stores."
        : null,
      reload: async () => {
        await refetchVectorStores();
      },
    },
    availableModels: {
      data: availableModelsData,
      loading: availableModelsLoading,
      error: availableModelsError instanceof Error
        ? availableModelsError.message
        : availableModelsError
        ? "Impossible de charger les modèles autorisés."
        : null,
      reload: async () => {
        await refetchAvailableModels();
      },
    },
    widgets: {
      data: widgetsWithComputerUse,
      loading: widgetsLoading,
      error: widgetsError instanceof Error
        ? widgetsError.message
        : widgetsError
        ? "Impossible de charger la bibliothèque de widgets."
        : null,
      reload: async () => {
        await refetchWidgets();
      },
    },
  };
};

export default useWorkflowResources;
