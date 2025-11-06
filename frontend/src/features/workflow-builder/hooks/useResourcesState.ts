import { useState } from "react";
import type {
  AvailableModel,
  VectorStoreSummary,
  WidgetTemplateSummary,
} from "../../../utils/backend";

interface UseResourcesStateReturn {
  // Vector Stores
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  setVectorStores: React.Dispatch<React.SetStateAction<VectorStoreSummary[]>>;
  setVectorStoresLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setVectorStoresError: React.Dispatch<React.SetStateAction<string | null>>;

  // Available Models
  availableModels: AvailableModel[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  setAvailableModels: React.Dispatch<React.SetStateAction<AvailableModel[]>>;
  setAvailableModelsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setAvailableModelsError: React.Dispatch<React.SetStateAction<string | null>>;

  // Widgets
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
  setWidgets: React.Dispatch<React.SetStateAction<WidgetTemplateSummary[]>>;
  setWidgetsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setWidgetsError: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Hook to manage external resources state (vector stores, models, widgets).
 */
export const useResourcesState = (): UseResourcesStateReturn => {
  // Vector Stores
  const [vectorStores, setVectorStores] = useState<VectorStoreSummary[]>([]);
  const [vectorStoresLoading, setVectorStoresLoading] = useState(false);
  const [vectorStoresError, setVectorStoresError] = useState<string | null>(null);

  // Available Models
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
  const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);

  // Widgets
  const [widgets, setWidgets] = useState<WidgetTemplateSummary[]>([]);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);

  return {
    vectorStores,
    vectorStoresLoading,
    vectorStoresError,
    setVectorStores,
    setVectorStoresLoading,
    setVectorStoresError,
    availableModels,
    availableModelsLoading,
    availableModelsError,
    setAvailableModels,
    setAvailableModelsLoading,
    setAvailableModelsError,
    widgets,
    widgetsLoading,
    widgetsError,
    setWidgets,
    setWidgetsLoading,
    setWidgetsError,
  };
};
