import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isPlainRecord } from "../../../../../utils/workflows";
import type { FlowNode } from "../../../types";
import { EMPTY_TRANSFORM_EXPRESSIONS } from "../constants";

type UseTransformInspectorStateParams = {
  nodeId: string;
  kind: FlowNode["data"]["kind"];
  parameters: FlowNode["data"]["parameters"];
  onTransformExpressionsChange: (
    nodeId: string,
    expressions: Record<string, unknown>,
  ) => void;
};

type TransformInspectorState = {
  transformExpressionsText: string;
  updateTransformDraft: (value: string, resetError?: boolean) => void;
  transformExpressionsError: string | null;
  setTransformExpressionsError: (value: string | null) => void;
  commitTransformExpressions: (rawValue?: string) => void;
};

export const useTransformInspectorState = ({
  nodeId,
  kind,
  parameters,
  onTransformExpressionsChange,
}: UseTransformInspectorStateParams): TransformInspectorState => {
  const transformExpressions = useMemo(() => {
    if (kind !== "transform" || !parameters) {
      return EMPTY_TRANSFORM_EXPRESSIONS;
    }

    const raw = (parameters as Record<string, unknown>).expressions;
    if (isPlainRecord(raw)) {
      return raw as Record<string, unknown>;
    }

    return EMPTY_TRANSFORM_EXPRESSIONS;
  }, [kind, parameters]);

  const [transformExpressionsText, setTransformExpressionsText] = useState(() =>
    kind === "transform" ? JSON.stringify(transformExpressions, null, 2) : "",
  );
  const [transformExpressionsError, setTransformExpressionsError] = useState<string | null>(null);
  const transformExpressionsSnapshotRef = useRef<string | null>(null);
  const transformDraftRef = useRef<string>("");

  useEffect(() => {
    if (kind !== "transform") {
      transformExpressionsSnapshotRef.current = null;
      transformDraftRef.current = "";
      setTransformExpressionsText("");
      setTransformExpressionsError(null);
      return;
    }

    const serialized = JSON.stringify(transformExpressions, null, 2);
    if (transformExpressionsSnapshotRef.current !== serialized) {
      transformExpressionsSnapshotRef.current = serialized;
      transformDraftRef.current = serialized;
      setTransformExpressionsText(serialized);
      setTransformExpressionsError(null);
    }
  }, [kind, transformExpressions]);

  useEffect(() => {
    transformDraftRef.current = transformExpressionsText;
  }, [transformExpressionsText]);

  const commitTransformExpressions = useCallback(
    (rawValue?: string) => {
      if (kind !== "transform") {
        return;
      }

      const candidate = rawValue ?? transformDraftRef.current ?? "";
      const trimmed = candidate.trim();

      if (!trimmed) {
        transformExpressionsSnapshotRef.current = "";
        setTransformExpressionsError(null);
        onTransformExpressionsChange(nodeId, {});
        return;
      }

      try {
        const parsed = JSON.parse(candidate);
        if (!isPlainRecord(parsed)) {
          throw new Error("La structure doit être un objet JSON.");
        }

        setTransformExpressionsError(null);
        const normalized = JSON.stringify(parsed, null, 2);
        transformExpressionsSnapshotRef.current = normalized;
        onTransformExpressionsChange(nodeId, parsed as Record<string, unknown>);
        if (normalized !== transformExpressionsText) {
          setTransformExpressionsText(normalized);
        }
        transformDraftRef.current = normalized;
      } catch (error) {
        setTransformExpressionsError(
          error instanceof Error ? error.message : "Expressions JSON invalides.",
        );
      }
    },
    [kind, nodeId, onTransformExpressionsChange, transformExpressionsText],
  );

  useEffect(() => {
    if (kind !== "transform") {
      return;
    }

    return () => {
      commitTransformExpressions(transformDraftRef.current);
    };
  }, [commitTransformExpressions, kind]);

  const updateTransformDraft = useCallback(
    (value: string, resetError?: boolean) => {
      setTransformExpressionsText(value);
      transformDraftRef.current = value;
      if (resetError) {
        setTransformExpressionsError(null);
      }
    },
    [],
  );

  return {
    transformExpressionsText,
    updateTransformDraft,
    transformExpressionsError,
    setTransformExpressionsError,
    commitTransformExpressions,
  };
};
