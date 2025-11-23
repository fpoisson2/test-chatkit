import { useMemo } from "react";

import type { WidgetRoot } from "../types";
import { WidgetRenderer as WidgetTreeRenderer } from "../widgets";

type WidgetRendererProps = {
  definition: Record<string, unknown>;
};

const isWidgetRoot = (value: Record<string, unknown>): value is WidgetRoot => {
  const { type, children } = value as Partial<WidgetRoot>;
  if (type !== "Card" && type !== "ListView") {
    return false;
  }
  return Array.isArray(children);
};

export const WidgetRenderer = ({ definition }: WidgetRendererProps) => {
  const normalized = useMemo(() => (isWidgetRoot(definition) ? definition : null), [definition]);

  if (!normalized) {
    return <div className="alert alert-danger text-sm">Définition du widget invalide.</div>;
  }

  return (
    <div className="widget-preview-section" data-theme={normalized.theme ?? undefined}>
      <WidgetTreeRenderer widget={normalized} />
    </div>
  );
};

