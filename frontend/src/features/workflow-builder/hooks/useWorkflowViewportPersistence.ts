import { useCallback, useEffect, useRef } from "react";

import type { ReactFlowInstance, Viewport } from "reactflow";

import { makeApiEndpointCandidates } from "../../../utils/backend";
import {
  isFiniteNumber,
  parseViewportKey,
  viewportKeyFor,
  type DeviceType,
  type WorkflowViewportListResponse,
  type WorkflowViewportRecord,
} from "../WorkflowBuilderUtils";

type UseWorkflowViewportPersistenceParams = {
  authHeader: Record<string, string>;
  backendUrl: string;
  baseMinViewportZoom: number;
  hasUserViewportChangeRef: React.MutableRefObject<boolean>;
  pendingViewportRestoreRef: React.MutableRefObject<boolean>;
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>;
  setMinViewportZoom: React.Dispatch<React.SetStateAction<number>>;
  token: string | null;
  viewportKeyRef: React.MutableRefObject<string | null>;
  viewportMemoryRef: React.MutableRefObject<Map<string, Viewport>>;
  viewportRef: React.MutableRefObject<Viewport | null>;
};

type RestoreViewportFn = () => void;

type UseWorkflowViewportPersistenceResult = {
  persistViewportMemory: () => void;
  refreshViewportConstraints: (flowInstance?: ReactFlowInstance | null) => number;
  restoreViewport: RestoreViewportFn;
};

export const useWorkflowViewportPersistence = ({
  authHeader,
  backendUrl,
  baseMinViewportZoom,
  hasUserViewportChangeRef,
  pendingViewportRestoreRef,
  reactFlowInstanceRef,
  setMinViewportZoom,
  token,
  viewportKeyRef,
  viewportMemoryRef,
  viewportRef,
}: UseWorkflowViewportPersistenceParams): UseWorkflowViewportPersistenceResult => {
  const timeoutIdsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const animationFrameIdsRef = useRef<number[]>([]);

  const clearScheduledTimeouts = useCallback(() => {
    for (const id of timeoutIdsRef.current) {
      clearTimeout(id);
    }
    timeoutIdsRef.current = [];
  }, []);

  const cancelAnimationFrames = useCallback(() => {
    if (typeof window === "undefined") {
      animationFrameIdsRef.current = [];
      return;
    }
    for (const id of animationFrameIdsRef.current) {
      window.cancelAnimationFrame(id);
    }
    animationFrameIdsRef.current = [];
  }, []);

  const refreshViewportConstraints = useCallback(
    (_flowInstance?: ReactFlowInstance | null) => {
      const applyMinZoom = (value: number) => {
        setMinViewportZoom((current) =>
          Math.abs(current - value) > 0.0001 ? value : current,
        );
        return value;
      };

      return applyMinZoom(baseMinViewportZoom);
    },
    [baseMinViewportZoom, setMinViewportZoom],
  );

  const persistViewportMemory = useCallback(() => {
    if (!token) {
      return;
    }
    const payload = Array.from(viewportMemoryRef.current.entries()).reduce<
      WorkflowViewportRecord[]
    >((accumulator, [key, viewport]) => {
      const parsedKey = parseViewportKey(key);
      if (!parsedKey) {
        return accumulator;
      }
      if (
        !isFiniteNumber(viewport.x) ||
        !isFiniteNumber(viewport.y) ||
        !isFiniteNumber(viewport.zoom)
      ) {
        return accumulator;
      }
      accumulator.push({
        workflow_id: parsedKey.workflowId,
        version_id: parsedKey.versionId,
        device_type: parsedKey.deviceType,
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
      });
      return accumulator;
    }, []);

    const candidates = makeApiEndpointCandidates(
      backendUrl,
      "/api/workflows/viewports",
    );

    void (async () => {
      let lastError: unknown = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            body: JSON.stringify({ viewports: payload }),
          });
          if (!response.ok) {
            throw new Error(
              `Échec de la sauvegarde du viewport (${response.status})`,
            );
          }
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          lastError = error;
        }
      }
      if (lastError) {
        console.error(lastError);
      }
    })();
  }, [authHeader, backendUrl, token, viewportMemoryRef]);

  const restoreViewport = useCallback<RestoreViewportFn>(() => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) {
      pendingViewportRestoreRef.current = true;
      return;
    }

    const applyViewport = () => {
      const flow = reactFlowInstanceRef.current;
      if (!flow) {
        return;
      }
      pendingViewportRestoreRef.current = false;
      const effectiveMinZoom = refreshViewportConstraints(flow);
      const savedViewport = viewportRef.current;

      if (savedViewport) {
        const targetViewport = {
          ...savedViewport,
          zoom: Math.max(savedViewport.zoom, effectiveMinZoom),
        } satisfies Viewport;

        flow.setViewport(targetViewport, { duration: 0 });

        const scheduleTimeout = (delay: number, callback: () => void) => {
          const timeoutId = setTimeout(() => {
            callback();
          }, delay);
          timeoutIdsRef.current.push(timeoutId);
        };

        scheduleTimeout(10, () => {
          const current = reactFlowInstanceRef.current;
          if (current) {
            current.setViewport(targetViewport, { duration: 0 });
          }
        });

        scheduleTimeout(50, () => {
          const current = reactFlowInstanceRef.current;
          if (current) {
            current.setViewport(targetViewport, { duration: 0 });
          }
        });

        scheduleTimeout(100, () => {
          const current = reactFlowInstanceRef.current;
          if (current) {
            current.setViewport(targetViewport, { duration: 0 });
            const actualViewport = current.getViewport();
            const match =
              Math.abs(actualViewport.x - targetViewport.x) < 1 &&
              Math.abs(actualViewport.y - targetViewport.y) < 1;
            if (match) {
              viewportRef.current = actualViewport;
              const key = viewportKeyRef.current;
              if (key) {
                viewportMemoryRef.current.set(key, { ...actualViewport });
              }
            }
          }
        });
      }
    };

    clearScheduledTimeouts();
    cancelAnimationFrames();

    if (typeof window === "undefined") {
      applyViewport();
      return;
    }

    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(applyViewport);
      animationFrameIdsRef.current.push(secondFrame);
    });
    animationFrameIdsRef.current.push(firstFrame);
  }, [
    cancelAnimationFrames,
    clearScheduledTimeouts,
    pendingViewportRestoreRef,
    reactFlowInstanceRef,
    refreshViewportConstraints,
    viewportKeyRef,
    viewportMemoryRef,
    viewportRef,
  ]);

  useEffect(() => {
    viewportMemoryRef.current.clear();
    if (!token) {
      return;
    }

    const controller = new AbortController();
    let isActive = true;

    const loadViewports = async () => {
      const candidates = makeApiEndpointCandidates(
        backendUrl,
        "/api/workflows/viewports",
      );
      let lastError: unknown = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              ...authHeader,
            },
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(
              `Échec du chargement des viewports (${response.status})`,
            );
          }
          const data: WorkflowViewportListResponse = await response.json();
          if (!isActive) {
            return;
          }
          viewportMemoryRef.current.clear();
          for (const entry of data.viewports ?? []) {
            if (
              typeof entry.workflow_id !== "number" ||
              !Number.isFinite(entry.workflow_id)
            ) {
              continue;
            }
            if (
              !isFiniteNumber(entry.x) ||
              !isFiniteNumber(entry.y) ||
              !isFiniteNumber(entry.zoom)
            ) {
              continue;
            }
            if (entry.x === 0 && entry.y === 0 && entry.zoom === 1) {
              continue;
            }
            const versionId =
              typeof entry.version_id === "number" && Number.isFinite(entry.version_id)
                ? entry.version_id
                : null;
            const entryDeviceType: DeviceType =
              entry.device_type === "mobile" ? "mobile" : "desktop";
            const key = viewportKeyFor(entry.workflow_id, versionId, entryDeviceType);
            if (key) {
              viewportMemoryRef.current.set(key, {
                x: entry.x,
                y: entry.y,
                zoom: entry.zoom,
              });
            }
          }
          const activeKey = viewportKeyRef.current;
          if (activeKey) {
            const restoredViewport = viewportMemoryRef.current.get(activeKey) ?? null;
            if (restoredViewport && !hasUserViewportChangeRef.current) {
              viewportRef.current = { ...restoredViewport };
              hasUserViewportChangeRef.current = true;
              pendingViewportRestoreRef.current = true;
              restoreViewport();
            }
          }
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          lastError = error;
        }
      }
      if (lastError) {
        console.error(lastError);
      }
    };

    void loadViewports();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [
    authHeader,
    backendUrl,
    hasUserViewportChangeRef,
    pendingViewportRestoreRef,
    restoreViewport,
    token,
    viewportKeyRef,
    viewportMemoryRef,
    viewportRef,
  ]);

  useEffect(() => {
    return () => {
      clearScheduledTimeouts();
      cancelAnimationFrames();
    };
  }, [cancelAnimationFrames, clearScheduledTimeouts]);

  return {
    persistViewportMemory,
    refreshViewportConstraints,
    restoreViewport,
  };
};

export type { RestoreViewportFn };
