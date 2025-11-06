import { useEffect, useRef, useState } from "react";
import type { WorkflowVersionResponse, WorkflowVersionSummary } from "../types";

interface WorkflowStateCache {
  selectedWorkflowId: number | null;
}

interface StoredWorkflowSelection {
  localWorkflowId: number | null;
}

interface UseVersionStateOptions {
  initialCache: WorkflowStateCache | null;
  initialStoredSelection: StoredWorkflowSelection | null;
}

interface UseVersionStateReturn {
  // State
  versions: WorkflowVersionSummary[];
  selectedVersionDetail: WorkflowVersionResponse | null;
  selectedWorkflowId: number | null;
  selectedVersionId: number | null;

  // Refs
  versionsRef: React.MutableRefObject<WorkflowVersionSummary[]>;
  selectedWorkflowIdRef: React.MutableRefObject<number | null>;
  selectedVersionIdRef: React.MutableRefObject<number | null>;
  draftVersionIdRef: React.MutableRefObject<number | null>;
  draftVersionSummaryRef: React.MutableRefObject<WorkflowVersionSummary | null>;

  // Setters
  setVersions: React.Dispatch<React.SetStateAction<WorkflowVersionSummary[]>>;
  setSelectedVersionDetail: React.Dispatch<React.SetStateAction<WorkflowVersionResponse | null>>;
  setSelectedWorkflowId: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedVersionId: React.Dispatch<React.SetStateAction<number | null>>;
}

/**
 * Hook to manage workflow version state including version selection and details.
 */
export const useVersionState = ({
  initialCache,
  initialStoredSelection,
}: UseVersionStateOptions): UseVersionStateReturn => {
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<WorkflowVersionResponse | null>(
    null,
  );

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(() => {
    if (initialCache?.selectedWorkflowId != null) {
      return initialCache.selectedWorkflowId;
    }
    return initialStoredSelection?.localWorkflowId ?? null;
  });

  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  const versionsRef = useRef<WorkflowVersionSummary[]>([]);
  const selectedWorkflowIdRef = useRef<number | null>(null);
  const selectedVersionIdRef = useRef<number | null>(null);
  const draftVersionIdRef = useRef<number | null>(null);
  const draftVersionSummaryRef = useRef<WorkflowVersionSummary | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    versionsRef.current = versions;
  }, [versions]);

  useEffect(() => {
    selectedWorkflowIdRef.current = selectedWorkflowId;
  }, [selectedWorkflowId]);

  useEffect(() => {
    selectedVersionIdRef.current = selectedVersionId;
  }, [selectedVersionId]);

  return {
    versions,
    selectedVersionDetail,
    selectedWorkflowId,
    selectedVersionId,
    versionsRef,
    selectedWorkflowIdRef,
    selectedVersionIdRef,
    draftVersionIdRef,
    draftVersionSummaryRef,
    setVersions,
    setSelectedVersionDetail,
    setSelectedWorkflowId,
    setSelectedVersionId,
  };
};
