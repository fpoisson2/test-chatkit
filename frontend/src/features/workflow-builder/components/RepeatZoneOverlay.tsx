import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { X } from "lucide-react";
import { useReactFlow, useStore } from "reactflow";

import styles from "../WorkflowBuilderPage.module.css";
import type { RepeatZone, RepeatZoneBounds } from "../types";

type RepeatZonePoint = { x: number; y: number };

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type RepeatZoneOverlayProps = {
  repeatZone: RepeatZone | null;
  draftBounds: RepeatZoneBounds | null;
  drawing: boolean;
  onDrawStart(point: RepeatZonePoint): void;
  onDrawUpdate(point: RepeatZonePoint): void;
  onDrawEnd(point: RepeatZonePoint): void;
  onMove(bounds: RepeatZoneBounds): void;
  onResize(bounds: RepeatZoneBounds): void;
  onRemove(): void;
  labels: {
    zoneTitle: string;
    remove: string;
    drawing: string;
    resize: Record<ResizeHandle, string>;
  };
  testId?: string;
};

const MIN_SIZE = 24;

const handles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const RepeatZoneOverlay = ({
  repeatZone,
  draftBounds,
  drawing,
  onDrawStart,
  onDrawUpdate,
  onDrawEnd,
  onMove,
  onResize,
  onRemove,
  labels,
  testId,
}: RepeatZoneOverlayProps) => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<
    | {
        mode: "draw" | "move" | "resize";
        start: RepeatZonePoint;
        initialBounds: RepeatZoneBounds;
        handle?: ResizeHandle;
      }
    | null
  >(null);
  const reactFlow = useReactFlow();
  const [translateX, translateY, zoom] = useStore((state) => state.transform);

  const projectPointer = useCallback(
    (event: ReactPointerEvent<Element>): RepeatZonePoint => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return { x: 0, y: 0 };
      }
      const rect = canvas.getBoundingClientRect();
      const point = reactFlow.project({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      return { x: point.x, y: point.y };
    },
    [reactFlow],
  );

  const releasePointerCapture = useCallback((event: ReactPointerEvent<Element>) => {
    const target = event.currentTarget as Element & {
      hasPointerCapture?: (pointerId: number) => boolean;
      releasePointerCapture?: (pointerId: number) => void;
    };
    if (typeof target.releasePointerCapture !== "function") {
      return;
    }
    if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(event.pointerId)) {
      return;
    }
    target.releasePointerCapture(event.pointerId);
  }, []);

  const applyResize = useCallback(
    (bounds: RepeatZoneBounds, delta: { x: number; y: number }, handle: ResizeHandle): RepeatZoneBounds => {
      let { x, y, width, height } = bounds;
      if (handle.includes("e")) {
        width = Math.max(MIN_SIZE, width + delta.x);
      }
      if (handle.includes("s")) {
        height = Math.max(MIN_SIZE, height + delta.y);
      }
      if (handle.includes("w")) {
        const nextWidth = width - delta.x;
        if (nextWidth < MIN_SIZE) {
          x += width - MIN_SIZE;
          width = MIN_SIZE;
        } else {
          x += delta.x;
          width = nextWidth;
        }
      }
      if (handle.includes("n")) {
        const nextHeight = height - delta.y;
        if (nextHeight < MIN_SIZE) {
          y += height - MIN_SIZE;
          height = MIN_SIZE;
        } else {
          y += delta.y;
          height = nextHeight;
        }
      }
      return { x, y, width, height };
    },
    [],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawing) {
        return;
      }
      event.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const point = projectPointer(event);
      interactionRef.current = {
        mode: "draw",
        start: point,
        initialBounds: { x: point.x, y: point.y, width: 0, height: 0 },
      };
      if (typeof canvas.setPointerCapture === "function") {
        canvas.setPointerCapture(event.pointerId);
      }
      onDrawStart(point);
    },
    [drawing, onDrawStart, projectPointer],
  );

  const finalizeInteraction = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const state = interactionRef.current;
      if (!state) {
        return;
      }
      const point = projectPointer(event);
      if (state.mode === "draw") {
        onDrawEnd(point);
      }
      interactionRef.current = null;
    },
    [onDrawEnd, projectPointer],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = interactionRef.current;
      if (!state) {
        return;
      }
      event.preventDefault();
      const point = projectPointer(event);
      if (state.mode === "draw") {
        onDrawUpdate(point);
      }
    },
    [onDrawUpdate, projectPointer],
  );

  const handleCanvasPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (interactionRef.current) {
        finalizeInteraction(event);
      }
      const canvas = canvasRef.current;
      if (canvas) {
        releasePointerCapture(event as ReactPointerEvent<Element>);
      }
    },
    [finalizeInteraction, releasePointerCapture],
  );

  const handleCanvasPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!interactionRef.current) {
        return;
      }
      finalizeInteraction(event);
      const canvas = canvasRef.current;
      if (canvas) {
        releasePointerCapture(event as ReactPointerEvent<Element>);
      }
    },
    [finalizeInteraction, releasePointerCapture],
  );

  const handleZonePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drawing || !repeatZone) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = projectPointer(event);
      interactionRef.current = {
        mode: "move",
        start: point,
        initialBounds: repeatZone.bounds,
      };
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [drawing, projectPointer, repeatZone],
  );

  const handleZonePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = interactionRef.current;
      if (!state || state.mode !== "move") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = projectPointer(event);
      const delta = { x: point.x - state.start.x, y: point.y - state.start.y };
      onMove({
        x: state.initialBounds.x + delta.x,
        y: state.initialBounds.y + delta.y,
        width: state.initialBounds.width,
        height: state.initialBounds.height,
      });
    },
    [onMove, projectPointer],
  );

  const handleZonePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (interactionRef.current && interactionRef.current.mode === "move") {
        interactionRef.current = null;
      }
      releasePointerCapture(event);
    },
    [releasePointerCapture],
  );

  const handleResizePointerDown = useCallback(
    (handle: ResizeHandle) =>
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (drawing || !repeatZone) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const point = projectPointer(event);
        interactionRef.current = {
          mode: "resize",
          start: point,
          initialBounds: repeatZone.bounds,
          handle,
        };
        if (typeof event.currentTarget.setPointerCapture === "function") {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      },
    [drawing, projectPointer, repeatZone],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = interactionRef.current;
      if (!state || state.mode !== "resize" || !state.handle) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = projectPointer(event);
      const delta = { x: point.x - state.start.x, y: point.y - state.start.y };
      onResize(applyResize(state.initialBounds, delta, state.handle));
    },
    [applyResize, onResize, projectPointer],
  );

  const handleResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (interactionRef.current && interactionRef.current.mode === "resize") {
        interactionRef.current = null;
      }
      releasePointerCapture(event);
    },
    [releasePointerCapture],
  );

  const zoneStyle = useMemo<CSSProperties | undefined>(() => {
    if (!repeatZone) {
      return undefined;
    }
    return {
      transform: `translate(${repeatZone.bounds.x}px, ${repeatZone.bounds.y}px)`,
      width: repeatZone.bounds.width,
      height: repeatZone.bounds.height,
    };
  }, [repeatZone]);

  const draftStyle = useMemo<CSSProperties | undefined>(() => {
    if (!draftBounds) {
      return undefined;
    }
    return {
      transform: `translate(${draftBounds.x}px, ${draftBounds.y}px)`,
      width: draftBounds.width,
      height: draftBounds.height,
    };
  }, [draftBounds]);

  return (
    <div className={styles.repeatZoneLayer}>
      <div
        ref={canvasRef}
        className={styles.repeatZoneCanvas}
        data-drawing={drawing ? "true" : "false"}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerLeave}
        data-testid={testId}
      >
        {drawing ? <div className={styles.repeatZoneDrawingHint}>{labels.drawing}</div> : null}
        <div
          className={styles.repeatZoneViewport}
          style={{
            transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
          }}
        >
          {repeatZone ? (
            <div
              role="group"
              aria-label={labels.zoneTitle}
              className={styles.repeatZoneBox}
              style={zoneStyle}
              onPointerDown={handleZonePointerDown}
              onPointerMove={handleZonePointerMove}
              onPointerUp={handleZonePointerUp}
            >
              <div className={styles.repeatZoneHeader}>
                <span className={styles.repeatZoneLabel}>{labels.zoneTitle}</span>
                <button
                  type="button"
                  className={styles.repeatZoneRemoveButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove();
                  }}
                  aria-label={labels.remove}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </div>
              {handles.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className={`${styles.repeatZoneHandle} ${styles[`repeatZoneHandle${handle.toUpperCase()}`]}`}
                  aria-label={labels.resize[handle]}
                  onPointerDown={handleResizePointerDown(handle)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                />
              ))}
            </div>
          ) : null}
          {draftBounds ? (
            <div className={styles.repeatZoneDraft} style={draftStyle} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default RepeatZoneOverlay;
