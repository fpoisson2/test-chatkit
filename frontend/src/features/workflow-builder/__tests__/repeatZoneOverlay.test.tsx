import type { ComponentProps } from "react";
import { render, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import ReactFlow, { ReactFlowProvider } from "reactflow";

import RepeatZoneOverlay from "../components/RepeatZoneOverlay";
import type { RepeatZone } from "../types";

const labels = {
  zoneTitle: "Repeat zone",
  remove: "Remove zone",
  drawing: "Draw here",
  resize: {
    n: "Resize up",
    s: "Resize down",
    e: "Resize right",
    w: "Resize left",
    ne: "Resize top right",
    nw: "Resize top left",
    se: "Resize bottom right",
    sw: "Resize bottom left",
  },
} as const;

const setup = (props: Partial<ComponentProps<typeof RepeatZoneOverlay>> = {}) => {
  const defaultProps = {
    repeatZone: null,
    draftBounds: null,
    drawing: false,
    onDrawStart: vi.fn(),
    onDrawUpdate: vi.fn(),
    onDrawEnd: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
    onRemove: vi.fn(),
    labels,
    testId: "repeat-overlay",
  } satisfies ComponentProps<typeof RepeatZoneOverlay>;

  const utils = render(
    <ReactFlowProvider>
      <div style={{ width: 400, height: 300 }}>
        <ReactFlow nodes={[]} edges={[]}>
          <RepeatZoneOverlay {...defaultProps} {...props} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>,
  );

  const canvas = utils.getByTestId("repeat-overlay");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }),
  });
  Object.defineProperty(canvas, "setPointerCapture", { value: () => {} });
  Object.defineProperty(canvas, "releasePointerCapture", { value: () => {} });
  Object.defineProperty(canvas, "hasPointerCapture", { value: () => false });

  return { ...utils, props: { ...defaultProps, ...props }, canvas };
};

describe("RepeatZoneOverlay", () => {
  test("calls draw callbacks when creating a zone", () => {
    const { canvas, props } = setup({ drawing: true });

    fireEvent.pointerDown(canvas, { clientX: 120, clientY: 140, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 180, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 180, clientY: 190, pointerId: 1 });

    expect(props.onDrawStart).toHaveBeenCalledWith({ x: 120, y: 140 });
    expect(props.onDrawUpdate).toHaveBeenCalledWith({ x: 180, y: 190 });
    expect(props.onDrawEnd).toHaveBeenCalledWith({ x: 180, y: 190 });
  });

  test("supports moving an existing zone", () => {
    const zone: RepeatZone = {
      id: "loop",
      label: null,
      bounds: { x: 100, y: 120, width: 160, height: 100 },
      nodeSlugs: ["agent"],
      metadata: {},
    };
  const { getByLabelText, props } = setup({ repeatZone: zone });
  const zoneElement = getByLabelText(labels.zoneTitle);
  Object.defineProperty(zoneElement, "setPointerCapture", { value: () => {} });
  Object.defineProperty(zoneElement, "releasePointerCapture", { value: () => {} });
  Object.defineProperty(zoneElement, "hasPointerCapture", { value: () => false });

    fireEvent.pointerDown(zoneElement, { clientX: 150, clientY: 160, pointerId: 2 });
    fireEvent.pointerMove(zoneElement, { clientX: 190, clientY: 200, pointerId: 2 });
    fireEvent.pointerUp(zoneElement, { clientX: 190, clientY: 200, pointerId: 2 });

    expect(props.onMove).toHaveBeenLastCalledWith({
      x: 140,
      y: 160,
      width: 160,
      height: 100,
    });
  });

  test("allows resizing from handles", () => {
    const zone: RepeatZone = {
      id: "loop",
      label: null,
      bounds: { x: 40, y: 60, width: 120, height: 80 },
      nodeSlugs: [],
      metadata: {},
    };
    const { getByLabelText, props } = setup({ repeatZone: zone });
  const handle = getByLabelText(labels.resize.e);
  Object.defineProperty(handle, "setPointerCapture", { value: () => {} });
  Object.defineProperty(handle, "releasePointerCapture", { value: () => {} });
  Object.defineProperty(handle, "hasPointerCapture", { value: () => false });

    fireEvent.pointerDown(handle, { clientX: 160, clientY: 100, pointerId: 3 });
    fireEvent.pointerMove(handle, { clientX: 200, clientY: 100, pointerId: 3 });
    fireEvent.pointerUp(handle, { clientX: 200, clientY: 100, pointerId: 3 });

    expect(props.onResize).toHaveBeenLastCalledWith({
      x: 40,
      y: 60,
      width: 160,
      height: 80,
    });
  });

  test("triggers removal through the action button", () => {
    const zone: RepeatZone = {
      id: "loop",
      label: null,
      bounds: { x: 80, y: 80, width: 100, height: 90 },
      nodeSlugs: [],
      metadata: {},
    };
    const { getByRole, props } = setup({ repeatZone: zone });

    fireEvent.click(getByRole("button", { name: labels.remove }));

    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });
});
