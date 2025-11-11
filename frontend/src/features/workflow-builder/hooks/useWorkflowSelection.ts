import { useCallback, type ChangeEvent, type MutableRefObject } from "react";
import type { DeviceType } from "../WorkflowBuilderUtils";

export interface UseWorkflowSelectionParams {
  selectedWorkflowId: number | null;
  isMobileLayout: boolean;
  setSelectedWorkflowId: (id: number | null) => void;
  setSelectedVersionId: (id: number | null) => void;
  closeWorkflowMenu: () => void;
  closeSidebar: () => void;
  loadVersions: (workflowId: number, versionId: number | null) => Promise<void>;
  loadVersionDetail: (
    workflowId: number,
    versionId: number,
    options?: { preserveViewport?: boolean }
  ) => Promise<void>;
  deviceType: DeviceType;
  viewportMemoryRef: MutableRefObject<Map<string, any>>;
  viewportKeyFor: (workflowId: number, versionId: number, deviceType: DeviceType) => string;
}

export interface UseWorkflowSelectionReturn {
  handleSelectWorkflow: (workflowId: number) => void;
  handleVersionChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

/**
 * Hook for managing workflow and version selection
 */
export const useWorkflowSelection = ({
  selectedWorkflowId,
  isMobileLayout,
  setSelectedWorkflowId,
  setSelectedVersionId,
  closeWorkflowMenu,
  closeSidebar,
  loadVersions,
  loadVersionDetail,
  deviceType,
  viewportMemoryRef,
  viewportKeyFor,
}: UseWorkflowSelectionParams): UseWorkflowSelectionReturn => {
  const handleSelectWorkflow = useCallback(
    (workflowId: number) => {
      if (workflowId === selectedWorkflowId) {
        if (isMobileLayout) {
          closeWorkflowMenu();
          closeSidebar();
        }
        return;
      }
      setSelectedWorkflowId(workflowId);
      setSelectedVersionId(null);
      closeWorkflowMenu();
      if (isMobileLayout) {
        closeSidebar();
      }
      void loadVersions(workflowId, null);
    },
    [
      closeSidebar,
      closeWorkflowMenu,
      isMobileLayout,
      loadVersions,
      selectedWorkflowId,
      setSelectedWorkflowId,
      setSelectedVersionId,
    ],
  );

  const handleVersionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = Number(event.target.value);
      const versionId = Number.isFinite(value) ? value : null;
      setSelectedVersionId(versionId);
      if (selectedWorkflowId && versionId) {
        const key = viewportKeyFor(selectedWorkflowId, versionId, deviceType);
        const hasSavedViewport = key ? viewportMemoryRef.current.has(key) : false;
        if (hasSavedViewport) {
          void loadVersionDetail(selectedWorkflowId, versionId);
        } else {
          void loadVersionDetail(selectedWorkflowId, versionId, { preserveViewport: true });
        }
      }
    },
    [deviceType, loadVersionDetail, selectedWorkflowId, setSelectedVersionId, viewportKeyFor, viewportMemoryRef],
  );

  return {
    handleSelectWorkflow,
    handleVersionChange,
  };
};
