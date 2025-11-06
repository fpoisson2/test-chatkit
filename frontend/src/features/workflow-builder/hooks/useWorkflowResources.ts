import { useCallback, useState } from "react";

import {
  modelRegistryApi,
  vectorStoreApi,
  widgetLibraryApi,
  type AvailableModel,
  type VectorStoreSummary,
  type WidgetTemplateSummary,
} from "../../../utils/backend";
import { useTokenResourceLoader } from "./useTokenResourceLoader";

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

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

const useWorkflowResources = (token: string | null): WorkflowResourcesState => {
  const [vectorStores, setVectorStores] = useState<VectorStoreSummary[]>([]);
  const [vectorStoresLoading, setVectorStoresLoading] = useState(false);
  const [vectorStoresError, setVectorStoresError] = useState<string | null>(null);
  const resetVectorStores = useCallback(() => {
    setVectorStores([]);
  }, []);
  const loadVectorStores = useCallback(
    () => vectorStoreApi.listStores(token as string),
    [token],
  );

  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);
  const resetAvailableModels = useCallback(() => {
    setAvailableModels([]);
  }, []);
  const loadAvailableModels = useCallback(
    () => modelRegistryApi.list(token as string),
    [token],
  );

  const [widgets, setWidgets] = useState<WidgetTemplateSummary[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);
  const resetWidgets = useCallback(() => {
    setWidgets([]);
  }, []);
  const loadWidgets = useCallback(
    () => widgetLibraryApi.listWorkflowWidgets(token as string),
    [token],
  );

  const makeReload = useCallback(
    async <T,>(
      options: {
        token: string | null;
        setLoading: (value: boolean) => void;
        setError: (value: string | null) => void;
        resetData: () => void;
        load: () => Promise<T>;
        setData: (value: T) => void;
        fallbackMessage: string;
      },
    ) => {
      const { token: authToken } = options;
      if (!authToken) {
        options.resetData();
        options.setError(null);
        options.setLoading(false);
        return;
      }

      options.setLoading(true);
      options.setError(null);

      try {
        const result = await options.load();
        options.setData(result);
      } catch (error) {
        options.setError(resolveErrorMessage(error, options.fallbackMessage));
        options.resetData();
      } finally {
        options.setLoading(false);
      }
    },
    [],
  );

  const reloadVectorStores = useCallback(() => {
    return makeReload({
      token,
      setLoading: setVectorStoresLoading,
      setError: setVectorStoresError,
      resetData: resetVectorStores,
      load: loadVectorStores,
      setData: setVectorStores,
      fallbackMessage: "Impossible de charger les vector stores.",
    });
  }, [loadVectorStores, makeReload, resetVectorStores, token]);

  const reloadAvailableModels = useCallback(() => {
    return makeReload({
      token,
      setLoading: setAvailableModelsLoading,
      setError: setAvailableModelsError,
      resetData: resetAvailableModels,
      load: loadAvailableModels,
      setData: setAvailableModels,
      fallbackMessage: "Impossible de charger les modèles autorisés.",
    });
  }, [loadAvailableModels, makeReload, resetAvailableModels, token]);

  const reloadWidgets = useCallback(() => {
    return makeReload({
      token,
      setLoading: setWidgetsLoading,
      setError: setWidgetsError,
      resetData: resetWidgets,
      load: loadWidgets,
      setData: setWidgets,
      fallbackMessage: "Impossible de charger la bibliothèque de widgets.",
    });
  }, [loadWidgets, makeReload, resetWidgets, token]);

  useTokenResourceLoader<VectorStoreSummary[]>({
    token,
    setData: setVectorStores,
    setLoading: setVectorStoresLoading,
    setError: setVectorStoresError,
    loadResource: loadVectorStores,
    fallbackErrorMessage: "Impossible de charger les vector stores.",
    resetData: resetVectorStores,
  });

  useTokenResourceLoader<AvailableModel[]>({
    token,
    setData: setAvailableModels,
    setLoading: setAvailableModelsLoading,
    setError: setAvailableModelsError,
    loadResource: loadAvailableModels,
    fallbackErrorMessage: "Impossible de charger les modèles autorisés.",
    resetData: resetAvailableModels,
  });

  useTokenResourceLoader<WidgetTemplateSummary[]>({
    token,
    setData: setWidgets,
    setLoading: setWidgetsLoading,
    setError: setWidgetsError,
    loadResource: loadWidgets,
    fallbackErrorMessage: "Impossible de charger la bibliothèque de widgets.",
    resetData: resetWidgets,
  });

  return {
    vectorStores: {
      data: vectorStores,
      loading: vectorStoresLoading,
      error: vectorStoresError,
      reload: reloadVectorStores,
    },
    availableModels: {
      data: availableModels,
      loading: availableModelsLoading,
      error: availableModelsError,
      reload: reloadAvailableModels,
    },
    widgets: {
      data: widgets,
      loading: widgetsLoading,
      error: widgetsError,
      reload: reloadWidgets,
    },
  };
};

export default useWorkflowResources;
