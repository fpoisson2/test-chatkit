/**
 * Custom hook for managing ReactFlow viewport state and persistence
 * Extracted from WorkflowBuilderPage to reduce complexity
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactFlowInstance, Viewport } from "reactflow";
import { makeApiEndpointCandidates } from "../../../utils/backend";
import {
  backendUrl,
  isFiniteNumber,
  parseViewportKey,
  viewportKeyFor,
  type DeviceType,
  type WorkflowViewportListResponse,
  type WorkflowViewportRecord,
  DESKTOP_MIN_VIEWPORT_ZOOM,
  MOBILE_MIN_VIEWPORT_ZOOM,
} from "../pageUtils";

type UseViewportManagementProps = {
  token: string | null;
  authHeader: Record<string, string>;
  isMobileLayout: boolean;
};

export const useViewportManagement = ({
  token,
  authHeader,
  isMobileLayout,
}: UseViewportManagementProps) => {
  const baseMinViewportZoom = useMemo(
    () => (isMobileLayout ? MOBILE_MIN_VIEWPORT_ZOOM : DESKTOP_MIN_VIEWPORT_ZOOM),
    [isMobileLayout],
  );

  const [minViewportZoom, setMinViewportZoom] = useState(baseMinViewportZoom);
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(undefined);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const viewportMemoryRef = useRef(new Map<string, Viewport>());
  const viewportKeyRef = useRef<string | null>(null);
  const hasUserViewportChangeRef = useRef(false);
  const pendingViewportRestoreRef = useRef(false);

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
  }, [authHeader, token]);

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
    [baseMinViewportZoom],
  );

  const restoreViewport = useCallback(() => {
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
        };

        // Apply viewport multiple times to ensure it sticks
        flow.setViewport(targetViewport, { duration: 0 });

        // Reapply after a short delay to override any automatic adjustments
        setTimeout(() => {
          if (reactFlowInstanceRef.current) {
            reactFlowInstanceRef.current.setViewport(targetViewport, { duration: 0 });
          }
        }, 10);

        setTimeout(() => {
          if (reactFlowInstanceRef.current) {
            reactFlowInstanceRef.current.setViewport(targetViewport, { duration: 0 });
          }
        }, 50);

        setTimeout(() => {
          if (reactFlowInstanceRef.current) {
            reactFlowInstanceRef.current.setViewport(targetViewport, { duration: 0 });
            const actualViewport = reactFlowInstanceRef.current.getViewport();
            const match = Math.abs(actualViewport.x - targetViewport.x) < 1 &&
                         Math.abs(actualViewport.y - targetViewport.y) < 1;
            // Update viewportRef only if viewport was successfully applied
            if (match) {
              viewportRef.current = actualViewport;
              const key = viewportKeyRef.current;
              if (key) {
                viewportMemoryRef.current.set(key, { ...actualViewport });
              }
            }
          }
        }, 100);
      }
    };

    if (typeof window === "undefined") {
      applyViewport();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(applyViewport);
    });
  }, [refreshViewportConstraints]);

  // Load viewports from backend
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
            // Skip default viewport values (0, 0, 1) as they indicate no user preference
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
  }, [authHeader, restoreViewport, token]);

  return {
    minViewportZoom,
    initialViewport,
    setInitialViewport,
    reactFlowInstanceRef,
    viewportRef,
    viewportMemoryRef,
    viewportKeyRef,
    hasUserViewportChangeRef,
    pendingViewportRestoreRef,
    persistViewportMemory,
    refreshViewportConstraints,
    restoreViewport,
  };
};
