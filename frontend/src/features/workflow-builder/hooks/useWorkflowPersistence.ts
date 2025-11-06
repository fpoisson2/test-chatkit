import { useCallback, useEffect, useMemo, useRef, type ChangeEvent } from "react";

import type { ReactFlowInstance, Viewport } from "reactflow";

import { makeApiEndpointCandidates } from "../../../utils/backend";
import { WorkflowImportError, parseWorkflowImport } from "../importWorkflow";
import {
  AUTO_SAVE_DELAY_MS,
  slugifyWorkflowName,
} from "../utils";
import {
  resolveDraftCandidate,
  versionSummaryFromResponse,
  viewportKeyFor,
  type DeviceType,
} from "../WorkflowBuilderUtils";
import type {
  FlowNode,
  SaveState,
  WorkflowSummary,
  WorkflowVersionResponse,
  WorkflowVersionSummary,
} from "../types";

type TranslationFunction = (key: string, params?: Record<string, unknown>) => string;

type LoadVersionsFn = (
  workflowId: number,
  preferredVersionId: number | null,
  options?: { preserveViewport?: boolean; background?: boolean },
) => Promise<boolean | void>;

type LoadWorkflowsFn = (options?: {
  selectWorkflowId?: number | null;
  selectVersionId?: number | null;
  excludeWorkflowId?: number | null;
  suppressLoadingState?: boolean;
}) => Promise<void>;

type UseWorkflowPersistenceParams = {
  authHeader: Record<string, string>;
  autoSaveSuccessMessage: string;
  backendUrl: string;
  buildGraphPayload: () => WorkflowVersionResponse["graph"];
  conditionGraphError: string | null;
  deviceType: DeviceType;
  disableSave: boolean;
  draftDisplayName: string;
  draftVersionIdRef: React.MutableRefObject<number | null>;
  draftVersionSummaryRef: React.MutableRefObject<WorkflowVersionSummary | null>;
  formatSaveFailureWithStatus: (status: number) => string;
  graphSnapshot: string;
  hasPendingChanges: boolean;
  importFileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  isCreatingDraftRef: React.MutableRefObject<boolean>;
  isExporting: boolean;
  isHydratingRef: React.MutableRefObject<boolean>;
  isImporting: boolean;
  lastSavedSnapshotRef: React.MutableRefObject<string | null>;
  loadVersions: LoadVersionsFn;
  loadWorkflows: LoadWorkflowsFn;
  loading: boolean;
  nodes: FlowNode[];
  persistViewportMemory: () => void;
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>;
  saveFailureMessage: string;
  saveState: SaveState;
  selectedWorkflow: WorkflowSummary | null;
  selectedWorkflowId: number | null;
  selectedVersionId: number | null;
  setInitialViewport: React.Dispatch<React.SetStateAction<Viewport | undefined>>;
  setIsExporting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsImporting: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
  setSelectedVersionId: React.Dispatch<React.SetStateAction<number | null>>;
  t: TranslationFunction;
  updateHasPendingChanges: (value: boolean) => void;
  versions: WorkflowVersionSummary[];
  viewportKeyRef: React.MutableRefObject<string | null>;
  viewportMemoryRef: React.MutableRefObject<Map<string, Viewport>>;
  viewportRef: React.MutableRefObject<Viewport | null>;
};

type UseWorkflowPersistenceResult = {
  handleSave: () => Promise<void>;
  handleImportFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleTriggerImport: () => void;
  handleExportWorkflow: () => Promise<void>;
};

const useWorkflowPersistence = ({
  authHeader,
  autoSaveSuccessMessage,
  backendUrl,
  buildGraphPayload,
  conditionGraphError,
  deviceType,
  disableSave,
  draftDisplayName,
  draftVersionIdRef,
  draftVersionSummaryRef,
  formatSaveFailureWithStatus,
  graphSnapshot,
  hasPendingChanges,
  importFileInputRef,
  isCreatingDraftRef,
  isExporting,
  isHydratingRef,
  isImporting,
  lastSavedSnapshotRef,
  loadVersions,
  loadWorkflows,
  loading,
  nodes,
  persistViewportMemory,
  reactFlowInstanceRef,
  saveFailureMessage,
  saveState,
  selectedWorkflow,
  selectedWorkflowId,
  selectedVersionId,
  setInitialViewport,
  setIsExporting,
  setIsImporting,
  setSaveMessage,
  setSaveState,
  setSelectedVersionId,
  t,
  updateHasPendingChanges,
  versions,
  viewportKeyRef,
  viewportMemoryRef,
  viewportRef,
}: UseWorkflowPersistenceParams): UseWorkflowPersistenceResult => {
  const autoSaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedWorkflowId) {
      lastSavedSnapshotRef.current = null;
      updateHasPendingChanges(false);
      return;
    }

    if (isHydratingRef.current) {
      isHydratingRef.current = false;
      return;
    }

    if (!lastSavedSnapshotRef.current) {
      lastSavedSnapshotRef.current = graphSnapshot;
      updateHasPendingChanges(false);
      return;
    }

    updateHasPendingChanges(graphSnapshot !== lastSavedSnapshotRef.current);
  }, [
    graphSnapshot,
    isHydratingRef,
    lastSavedSnapshotRef,
    selectedWorkflowId,
    updateHasPendingChanges,
  ]);

  useEffect(() => {
    if (conditionGraphError) {
      setSaveState((previous) => (previous === "saving" ? previous : "error"));
      setSaveMessage(conditionGraphError);
    }
  }, [conditionGraphError, setSaveMessage, setSaveState]);

  const extractSaveErrorMessage = useCallback(
    async (response: Response) => {
      try {
        const payload = (await response.json()) as { detail?: unknown };
        if (payload && typeof payload.detail === "string") {
          const trimmed = payload.detail.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      } catch (error) {
        console.error("Impossible de lire la réponse d'erreur de sauvegarde", error);
      }
      return formatSaveFailureWithStatus(response.status);
    },
    [formatSaveFailureWithStatus],
  );

  const handleSave = useCallback(async () => {
    setSaveMessage(null);
    if (!selectedWorkflowId) {
      setSaveState("error");
      setSaveMessage("Sélectionnez un workflow avant d'enregistrer une version.");
      return;
    }

    const nodesWithErrors = nodes.filter((node) => node.data.parametersError);
    if (nodesWithErrors.length > 0) {
      setSaveState("error");
      setSaveMessage("Corrigez les paramètres JSON invalides avant d'enregistrer.");
      return;
    }

    if (conditionGraphError) {
      setSaveState("error");
      setSaveMessage(conditionGraphError);
      return;
    }

    const graphPayload = buildGraphPayload();
    const graphSnapshot = JSON.stringify(graphPayload);

    if (!draftVersionIdRef.current) {
      const draftFromState = resolveDraftCandidate(versions);
      if (draftFromState) {
        draftVersionIdRef.current = draftFromState.id;
        draftVersionSummaryRef.current = draftFromState;
      }
    }

    const draftId = draftVersionIdRef.current;

    if (!draftId) {
      if (isCreatingDraftRef.current) {
        return;
      }

      const endpoint = `/api/workflows/${selectedWorkflowId}/versions`;
      const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
      let lastError: Error | null = null;
      isCreatingDraftRef.current = true;
      setSaveState("saving");
      try {
        for (const url of candidates) {
          if (draftVersionIdRef.current) {
            console.warn("DraftExistsError", {
              workflowId: selectedWorkflowId,
              draftId: draftVersionIdRef.current,
            });
            return;
          }
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify({ graph: graphPayload, mark_as_active: false }),
            });
            if (!response.ok) {
              const message = await extractSaveErrorMessage(response);
              throw new Error(message);
            }
            const created: WorkflowVersionResponse = await response.json();
            const summary: WorkflowVersionSummary = {
              ...versionSummaryFromResponse(created),
              name: draftDisplayName,
            };
            const newViewportKey = viewportKeyFor(
              selectedWorkflowId,
              summary.id,
              deviceType,
            );
            const currentViewport =
              reactFlowInstanceRef.current?.getViewport() ?? viewportRef.current;
            if (newViewportKey && currentViewport) {
              viewportMemoryRef.current.set(newViewportKey, { ...currentViewport });
              persistViewportMemory();
              setInitialViewport({ ...currentViewport });
            }
            viewportKeyRef.current = newViewportKey;
            viewportRef.current = currentViewport ? { ...currentViewport } : null;
            draftVersionIdRef.current = summary.id;
            draftVersionSummaryRef.current = summary;
            setSelectedVersionId(summary.id);
            await loadVersions(selectedWorkflowId, summary.id, {
              preserveViewport: true,
              background: true,
            });
            if (currentViewport && reactFlowInstanceRef.current) {
              setTimeout(() => {
                reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
              }, 100);
              setTimeout(() => {
                reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
              }, 200);
              setTimeout(() => {
                reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
              }, 300);
            }
            lastSavedSnapshotRef.current = graphSnapshot;
            updateHasPendingChanges(false);
            setSaveState("saved");
            setSaveMessage(autoSaveSuccessMessage);
            setTimeout(() => {
              setSaveState("idle");
              setSaveMessage((previous) =>
                previous === autoSaveSuccessMessage ? null : previous,
              );
            }, 1500);
            return;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              continue;
            }
            lastError =
              error instanceof Error ? error : new Error(saveFailureMessage);
          }
        }
      } finally {
        isCreatingDraftRef.current = false;
      }
      setSaveState("error");
      updateHasPendingChanges(true);
      setSaveMessage(lastError?.message ?? saveFailureMessage);
      return;
    }

    const endpoint = `/api/workflows/${selectedWorkflowId}/versions/${draftId}`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;
    setSaveState("saving");
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ graph: graphPayload }),
        });
        if (!response.ok) {
          const message = await extractSaveErrorMessage(response);
          throw new Error(message);
        }
        const updated: WorkflowVersionResponse = await response.json();
        const summary: WorkflowVersionSummary = {
          ...versionSummaryFromResponse(updated),
          name: draftDisplayName,
        };
        draftVersionSummaryRef.current = summary;
        const currentViewport = reactFlowInstanceRef.current?.getViewport();
        const viewportKey = viewportKeyFor(selectedWorkflowId, summary.id, deviceType);
        if (currentViewport) {
          setInitialViewport({ ...currentViewport });
          if (viewportKey) {
            viewportMemoryRef.current.set(viewportKey, { ...currentViewport });
            persistViewportMemory();
          }
        }
        await loadVersions(selectedWorkflowId, summary.id, {
          preserveViewport: true,
          background: true,
        });
        if (currentViewport && reactFlowInstanceRef.current) {
          setTimeout(() => {
            reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
          }, 100);
          setTimeout(() => {
            reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
          }, 200);
          setTimeout(() => {
            reactFlowInstanceRef.current?.setViewport(currentViewport, { duration: 0 });
          }, 300);
        }
        lastSavedSnapshotRef.current = graphSnapshot;
        updateHasPendingChanges(false);
        setSaveState("saved");
        setSaveMessage(autoSaveSuccessMessage);
        setTimeout(() => {
          setSaveState("idle");
          setSaveMessage((previous) =>
            previous === autoSaveSuccessMessage ? null : previous,
          );
        }, 1500);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error(saveFailureMessage);
      }
    }

    setSaveState("error");
    updateHasPendingChanges(true);
    setSaveMessage(lastError?.message ?? saveFailureMessage);
  }, [
    autoSaveSuccessMessage,
    authHeader,
    backendUrl,
    buildGraphPayload,
    conditionGraphError,
    deviceType,
    draftDisplayName,
    draftVersionIdRef,
    draftVersionSummaryRef,
    extractSaveErrorMessage,
    isCreatingDraftRef,
    loadVersions,
    nodes,
    persistViewportMemory,
    reactFlowInstanceRef,
    saveFailureMessage,
    selectedWorkflowId,
    setInitialViewport,
    setSaveMessage,
    setSaveState,
    setSelectedVersionId,
    t,
    updateHasPendingChanges,
    versions,
    viewportKeyRef,
    viewportMemoryRef,
    viewportRef,
  ]);

  useEffect(() => {
    if (
      !hasPendingChanges ||
      disableSave ||
      saveState === "saving" ||
      loading ||
      !selectedWorkflowId
    ) {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      return;
    }

    if (autoSaveTimeoutRef.current !== null) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      void handleSave();
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveTimeoutRef.current !== null) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [
    disableSave,
    handleSave,
    hasPendingChanges,
    loading,
    saveState,
    selectedWorkflowId,
  ]);

  const resolveImportErrorMessage = useCallback(
    (error: unknown): string => {
      if (error instanceof WorkflowImportError) {
        switch (error.reason) {
          case "invalid_json":
            return t("workflowBuilder.import.errorInvalidJson");
          case "missing_nodes":
            return t("workflowBuilder.import.errorMissingNodes");
          case "invalid_node":
            return t("workflowBuilder.import.errorInvalidNode");
          case "invalid_edge":
            return t("workflowBuilder.import.errorInvalidEdge");
          case "invalid_graph":
          default:
            return t("workflowBuilder.import.errorInvalidGraph");
        }
      }
      if (error instanceof Error) {
        return error.message;
      }
      return t("workflowBuilder.import.error");
    },
    [t],
  );

  const processImportPayload = useCallback(
    async (rawText: string) => {
      setIsImporting(true);
      try {
        const parsed = parseWorkflowImport(rawText);
        let targetWorkflowId = selectedWorkflowId ?? null;
        if (targetWorkflowId == null && parsed.workflowId != null) {
          targetWorkflowId = parsed.workflowId;
        }

        const requestPayload: Record<string, unknown> = {
          graph: parsed.graph,
        };

        const ensureVersionName = () =>
          t("workflowBuilder.import.defaultVersionName", {
            timestamp: new Date().toLocaleString(),
          });

        if (targetWorkflowId != null) {
          requestPayload.workflow_id = targetWorkflowId;
          if (parsed.slug) {
            requestPayload.slug = parsed.slug;
          }
          if (parsed.displayName) {
            requestPayload.display_name = parsed.displayName;
          }
          if (parsed.description !== undefined) {
            requestPayload.description = parsed.description;
          }
          if (parsed.markAsActive !== undefined) {
            requestPayload.mark_as_active = parsed.markAsActive;
          }
          requestPayload.version_name = parsed.versionName ?? ensureVersionName();
        } else {
          let displayName = parsed.displayName ?? null;
          if (!displayName) {
            const proposed = window.prompt(
              t("workflowBuilder.import.promptDisplayName"),
            );
            if (!proposed) {
              setSaveState("error");
              setSaveMessage(t("workflowBuilder.import.errorMissingName"));
              return;
            }
            const trimmed = proposed.trim();
            if (!trimmed) {
              setSaveState("error");
              setSaveMessage(t("workflowBuilder.import.errorMissingName"));
              return;
            }
            displayName = trimmed;
          }
          const slug = parsed.slug ?? slugifyWorkflowName(displayName);
          requestPayload.display_name = displayName;
          requestPayload.slug = slug;
          requestPayload.description = parsed.description ?? null;
          requestPayload.mark_as_active = parsed.markAsActive ?? true;
          requestPayload.version_name = parsed.versionName ?? ensureVersionName();
        }

        setSaveState("saving");
        setSaveMessage(t("workflowBuilder.import.saving"));

        const candidates = makeApiEndpointCandidates(
          backendUrl,
          "/api/workflows/import",
        );
        let lastError: Error | null = null;

        for (const url of candidates) {
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeader,
              },
              body: JSON.stringify(requestPayload),
            });
            if (!response.ok) {
              let detail = t("workflowBuilder.import.errorWithStatus", {
                status: response.status,
              });
              try {
                const data = await response.json();
                if (data && typeof data.detail === "string" && data.detail.trim()) {
                  detail = data.detail.trim();
                }
              } catch (parseError) {
                lastError =
                  parseError instanceof Error
                    ? parseError
                    : new Error(t("workflowBuilder.import.error"));
              }
              throw new Error(detail);
            }
            const imported: WorkflowVersionResponse = await response.json();
            await loadWorkflows({
              selectWorkflowId: imported.workflow_id,
              selectVersionId: imported.id,
            });
            setSaveState("saved");
            setSaveMessage(t("workflowBuilder.import.success"));
            setTimeout(() => setSaveState("idle"), 1500);
            return;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              continue;
            }
            lastError =
              error instanceof Error
                ? error
                : new Error(t("workflowBuilder.import.error"));
          }
        }

        if (lastError) {
          throw lastError;
        }
        throw new Error(t("workflowBuilder.import.error"));
      } catch (error) {
        setSaveState("error");
        setSaveMessage(resolveImportErrorMessage(error));
      } finally {
        setIsImporting(false);
      }
    },
    [
      authHeader,
      backendUrl,
      loadWorkflows,
      resolveImportErrorMessage,
      selectedWorkflowId,
      setIsImporting,
      setSaveMessage,
      setSaveState,
      t,
    ],
  );

  const handleImportFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";
      if (!file) {
        return;
      }
      try {
        setSaveMessage(null);
        const text = await file.text();
        await processImportPayload(text);
      } catch (_error) {
        setSaveState("error");
        setSaveMessage(t("workflowBuilder.import.errorFileRead"));
        setIsImporting(false);
      }
    },
    [processImportPayload, setIsImporting, setSaveMessage, setSaveState, t],
  );

  const handleTriggerImport = useCallback(() => {
    if (loading || isImporting) {
      return;
    }
    setSaveMessage(null);
    importFileInputRef.current?.click();
  }, [importFileInputRef, isImporting, loading, setSaveMessage]);

  const handleExportWorkflow = useCallback(async () => {
    if (!selectedWorkflowId || !selectedVersionId || isExporting) {
      return;
    }

    setIsExporting(true);
    setSaveState("saving");
    setSaveMessage(t("workflowBuilder.export.preparing"));

    const endpoint = `/api/workflows/${selectedWorkflowId}/versions/${selectedVersionId}/export`;
    const candidates = makeApiEndpointCandidates(backendUrl, endpoint);
    let lastError: Error | null = null;

    try {
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              Accept: "application/json",
              ...authHeader,
            },
          });
          if (!response.ok) {
            throw new Error(
              t("workflowBuilder.export.errorWithStatus", { status: response.status }),
            );
          }

          const graph = await response.json();
          if (typeof document === "undefined") {
            throw new Error(t("workflowBuilder.export.error"));
          }

          const serialized = JSON.stringify(graph, null, 2);
          const workflowLabel =
            selectedWorkflow?.display_name?.trim() ||
            selectedWorkflow?.slug ||
            `workflow-${selectedWorkflowId}`;
          const versionSummary =
            versions.find((version) => version.id === selectedVersionId) ?? null;
          const workflowSlug = slugifyWorkflowName(workflowLabel);
          const versionSlug = versionSummary
            ? slugifyWorkflowName(
                versionSummary.name?.trim() || `v${versionSummary.version}`,
              )
            : slugifyWorkflowName(`version-${selectedVersionId}`);
          const fileName = `${workflowSlug}-${versionSlug}.json`;

          const blob = new Blob([serialized], {
            type: "application/json;charset=utf-8",
          });
          const blobUrl = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = blobUrl;
          anchor.download = fileName;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(blobUrl);

          setSaveState("saved");
          setSaveMessage(t("workflowBuilder.export.success"));
          setTimeout(() => setSaveState("idle"), 1500);
          return;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(t("workflowBuilder.export.error"));
        }
      }

      setSaveState("error");
      setSaveMessage(lastError?.message ?? t("workflowBuilder.export.error"));
    } finally {
      setIsExporting(false);
    }
  }, [
    authHeader,
    backendUrl,
    isExporting,
    selectedWorkflow,
    selectedWorkflowId,
    selectedVersionId,
    setIsExporting,
    setSaveMessage,
    setSaveState,
    t,
    versions,
  ]);

  return useMemo(
    () => ({
      handleSave,
      handleImportFileChange,
      handleTriggerImport,
      handleExportWorkflow,
    }),
    [handleExportWorkflow, handleImportFileChange, handleSave, handleTriggerImport],
  );
};

export default useWorkflowPersistence;
