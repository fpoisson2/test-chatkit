import { useEffect, useMemo, useState } from "react";

import {
  widgetLibraryApi,
  type WidgetTemplateSummary,
} from "../../../../../utils/backend";
import { getWidgetNodeConfig } from "../../../../../utils/workflows";
import type { FlowNode } from "../../../types";
import { isTestEnvironment } from "../constants";

type UseWidgetInspectorStateParams = {
  parameters: FlowNode["data"]["parameters"];
  token: string | null;
  widgets: WidgetTemplateSummary[];
  widgetsLoading: boolean;
  widgetsError: string | null;
};

type WidgetInspectorState = {
  widgetNodeSource: "library" | "variable";
  widgetNodeSlug: string;
  trimmedWidgetNodeSlug: string;
  widgetNodeDefinitionExpression: string;
  widgetNodeVariables: ReturnType<typeof getWidgetNodeConfig>["variables"];
  widgetNodeAwaitAction: boolean;
  widgetDefinition: Record<string, unknown> | null;
  widgetDefinitionLoading: boolean;
  widgetDefinitionError: string | null;
  widgetNodeSelectValue: string;
  widgetNodeValidationMessage: string | null;
};

export const useWidgetInspectorState = ({
  parameters,
  token,
  widgets,
  widgetsLoading,
  widgetsError,
}: UseWidgetInspectorStateParams): WidgetInspectorState => {
  const widgetNodeConfig = useMemo(() => getWidgetNodeConfig(parameters), [parameters]);
  const widgetNodeSource = widgetNodeConfig.source;
  const widgetNodeSlug = widgetNodeConfig.slug;
  const widgetNodeVariables = widgetNodeConfig.variables;
  const widgetNodeAwaitAction = widgetNodeConfig.awaitAction;
  const widgetNodeDefinitionExpression = widgetNodeConfig.definitionExpression;

  const trimmedWidgetNodeSlug = widgetNodeSlug.trim();

  const widgetNodeSelectedWidget = useMemo(() => {
    if (widgetNodeSource !== "library") {
      return null;
    }

    if (!trimmedWidgetNodeSlug) {
      return null;
    }

    return widgets.find((widget) => widget.slug === trimmedWidgetNodeSlug) ?? null;
  }, [widgetNodeSource, trimmedWidgetNodeSlug, widgets]);

  const [widgetDefinition, setWidgetDefinition] = useState<Record<string, unknown> | null>(null);
  const [widgetDefinitionLoading, setWidgetDefinitionLoading] = useState(false);
  const [widgetDefinitionError, setWidgetDefinitionError] = useState<string | null>(null);

  useEffect(() => {
    if (widgetNodeSource !== "library" || !trimmedWidgetNodeSlug || !token || isTestEnvironment) {
      setWidgetDefinition(null);
      setWidgetDefinitionError(null);
      setWidgetDefinitionLoading(false);
      return;
    }

    let isCancelled = false;
    setWidgetDefinitionLoading(true);
    setWidgetDefinitionError(null);

    widgetLibraryApi
      .getWidget(token, trimmedWidgetNodeSlug)
      .then((widget) => {
        if (isCancelled) {
          return;
        }
        setWidgetDefinition(widget.definition);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setWidgetDefinition(null);
        setWidgetDefinitionError(
          error instanceof Error ? error.message : "Impossible de charger le widget sélectionné.",
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setWidgetDefinitionLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [widgetNodeSource, trimmedWidgetNodeSlug, token]);

  let widgetNodeValidationMessage: string | null = null;
  if (
    widgetNodeSource === "library" &&
    !widgetsLoading &&
    !widgetsError &&
    widgets.length > 0
  ) {
    if (!trimmedWidgetNodeSlug) {
      widgetNodeValidationMessage = "Sélectionnez un widget à afficher.";
    } else if (!widgetNodeSelectedWidget) {
      widgetNodeValidationMessage =
        "Le widget sélectionné n'est plus disponible. Choisissez-en un autre.";
    }
  } else if (widgetNodeSource === "variable") {
    if (!widgetNodeDefinitionExpression.trim()) {
      widgetNodeValidationMessage =
        "Renseignez une expression qui retourne le JSON du widget à afficher.";
    }
  }

  const widgetNodeSelectValue =
    widgetNodeSource === "library" && widgetNodeSelectedWidget ? trimmedWidgetNodeSlug : "";

  return {
    widgetNodeSource,
    widgetNodeSlug,
    trimmedWidgetNodeSlug,
    widgetNodeDefinitionExpression,
    widgetNodeVariables,
    widgetNodeAwaitAction,
    widgetDefinition,
    widgetDefinitionLoading,
    widgetDefinitionError,
    widgetNodeSelectValue,
    widgetNodeValidationMessage,
  };
};
