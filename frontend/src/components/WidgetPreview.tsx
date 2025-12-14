import { useMemo } from "react";

import type { ActionConfig, WidgetRoot } from "../chatkit/types";
import { WidgetRenderer } from "../chatkit/widgets";

const normalizeDefinition = (definition: Record<string, unknown>): WidgetRoot | null => {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    return null;
  }
  if (typeof (definition as { type?: unknown }).type !== "string") {
    return null;
  }
  return definition as WidgetRoot;
};

const previewContext = {
  onAction: (action: ActionConfig) => {
    // Log actions triggered from the preview to help debugging without wiring real callbacks.
  },
  onFormData: (data: FormData) => {
    // eslint-disable-next-line no-console
  },
  voiceSession: {
    status: "idle",
    isListening: false,
    transcripts: [],
    startVoiceSession: async () => ,
    stopVoiceSession: () => ,
  },
};

type WidgetPreviewProps = {
  definition: Record<string, unknown>;
};

export const WidgetPreview = ({ definition }: WidgetPreviewProps) => {
  const normalized = useMemo(() => normalizeDefinition(definition), [definition]);

  if (!normalized) {
    return <div className="alert alert-danger text-sm">Définition du widget invalide.</div>;
  }

  return <WidgetRenderer widget={normalized} context={previewContext} />;
};
