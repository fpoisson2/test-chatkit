import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getDocxTemplateConfig, isPlainRecord } from "../../../../../utils/workflows";
import type { FlowNode } from "../../../types";

const EMPTY_DATA = Object.freeze({});

export type UseDocxTemplateInspectorStateParams = {
  kind: FlowNode["data"]["kind"];
  nodeId: string;
  parameters: FlowNode["data"]["parameters"];
  onDataChange: (nodeId: string, data: Record<string, unknown>) => void;
};

export type DocxTemplateInspectorState = {
  dataText: string;
  dataError: string | null;
  updateDataDraft: (value: string, resetError?: boolean) => void;
  commitData: (value?: string) => void;
  setDataError: (value: string | null) => void;
};

export const useDocxTemplateInspectorState = ({
  kind,
  nodeId,
  parameters,
  onDataChange,
}: UseDocxTemplateInspectorStateParams): DocxTemplateInspectorState => {
  const docxData = useMemo(() => {
    if (kind !== "docx_template") {
      return EMPTY_DATA;
    }

    const config = getDocxTemplateConfig(parameters);
    if (isPlainRecord(config.data)) {
      return config.data;
    }

    return EMPTY_DATA;
  }, [kind, parameters]);

  const [dataText, setDataText] = useState(() =>
    kind === "docx_template" ? JSON.stringify(docxData, null, 2) : "",
  );
  const [dataError, setDataError] = useState<string | null>(null);
  const snapshotRef = useRef<string | null>(null);
  const draftRef = useRef<string>("");

  useEffect(() => {
    if (kind !== "docx_template") {
      snapshotRef.current = null;
      draftRef.current = "";
      setDataText("");
      setDataError(null);
      return;
    }

    const serialized = JSON.stringify(docxData, null, 2);
    if (snapshotRef.current !== serialized) {
      snapshotRef.current = serialized;
      draftRef.current = serialized;
      setDataText(serialized);
      setDataError(null);
    }
  }, [docxData, kind]);

  useEffect(() => {
    draftRef.current = dataText;
  }, [dataText]);

  const commitData = useCallback(
    (rawValue?: string) => {
      if (kind !== "docx_template") {
        return;
      }

      const candidate = rawValue ?? draftRef.current ?? "";
      const trimmed = candidate.trim();

      if (!trimmed) {
        snapshotRef.current = "";
        setDataError(null);
        onDataChange(nodeId, {});
        return;
      }

      try {
        const parsed = JSON.parse(candidate);
        if (!isPlainRecord(parsed)) {
          throw new Error("Les données doivent être un objet JSON.");
        }

        setDataError(null);
        const normalized = JSON.stringify(parsed, null, 2);
        snapshotRef.current = normalized;
        onDataChange(nodeId, parsed as Record<string, unknown>);
        if (normalized !== dataText) {
          setDataText(normalized);
        }
        draftRef.current = normalized;
      } catch (error) {
        setDataError(error instanceof Error ? error.message : "JSON invalide.");
      }
    },
    [dataText, kind, nodeId, onDataChange],
  );

  useEffect(() => {
    if (kind !== "docx_template") {
      return;
    }

    return () => {
      commitData(draftRef.current);
    };
  }, [commitData, kind]);

  const updateDataDraft = useCallback((value: string, resetError?: boolean) => {
    setDataText(value);
    draftRef.current = value;
    if (resetError) {
      setDataError(null);
    }
  }, []);

  return {
    dataText,
    dataError,
    updateDataDraft,
    commitData,
    setDataError,
  };
};
