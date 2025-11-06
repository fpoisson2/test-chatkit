import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MutableRefObject } from "react";

import type { FlowEdge, FlowNode, FlowNodeData } from "../types";
import { useWorkflowKeyboardShortcuts } from "./useWorkflowKeyboardShortcuts";

const createNode = (id: string): FlowNode => {
  const data: FlowNodeData = {
    slug: id,
    kind: "start",
    displayName: "Node",
    label: "Node",
    isEnabled: true,
    agentKey: null,
    parameters: {} as FlowNodeData["parameters"],
    parametersText: "",
    parametersError: null,
    metadata: {},
  };

  return {
    id,
    data,
    type: "default",
    position: { x: 0, y: 0 },
    selected: false,
    dragging: false,
    width: 0,
    height: 0,
  } as FlowNode;
};

const createEdge = (id: string, source: string, target: string): FlowEdge =>
  ({
    id,
    source,
    target,
    data: { metadata: {} },
  } as FlowEdge);

const createRef = <T,>(value: T): MutableRefObject<T> => ({ current: value });

describe("useWorkflowKeyboardShortcuts", () => {
  it("copies the selection with Ctrl+C", () => {
    const copySelectionToClipboard = vi.fn().mockResolvedValue(true);
    const pasteClipboardGraph = vi.fn().mockResolvedValue(true);
    const applySelection = vi.fn();
    const copySequenceRef = createRef<{ count: number; lastTimestamp: number }>({
      count: 0,
      lastTimestamp: 0,
    });
    const redoHistory = vi.fn().mockReturnValue(false);
    const undoHistory = vi.fn().mockReturnValue(false);
    const removeElements = vi.fn();
    const resetCopySequence = vi.fn(() => {
      copySequenceRef.current.count = 0;
      copySequenceRef.current.lastTimestamp = 0;
    });

    const nodesRef = createRef<FlowNode[]>([createNode("node-1")]);
    const edgesRef = createRef<FlowEdge[]>([]);
    const selectedNodeIdsRef = createRef<Set<string>>(new Set());
    const selectedEdgeIdsRef = createRef<Set<string>>(new Set());
    const workflowBusyRef = createRef(false);

    renderHook(() =>
      useWorkflowKeyboardShortcuts({
        applySelection,
        copySelectionToClipboard,
        copySequenceRef,
        edgesRef,
        nodesRef,
        pasteClipboardGraph,
        redoHistory,
        removeElements,
        resetCopySequence,
        selectedEdgeIdsRef,
        selectedNodeIdsRef,
        undoHistory,
        workflowBusyRef,
      }),
    );

    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(copySelectionToClipboard).toHaveBeenCalledWith({ includeEntireGraph: false });
    expect(event.defaultPrevented).toBe(true);
  });

  it("selects all nodes and edges with Ctrl+A", () => {
    const copySelectionToClipboard = vi.fn().mockResolvedValue(true);
    const pasteClipboardGraph = vi.fn().mockResolvedValue(true);
    const applySelection = vi.fn();
    const copySequenceRef = createRef<{ count: number; lastTimestamp: number }>({
      count: 0,
      lastTimestamp: 0,
    });
    const redoHistory = vi.fn().mockReturnValue(false);
    const undoHistory = vi.fn().mockReturnValue(false);
    const removeElements = vi.fn();
    const resetCopySequence = vi.fn(() => {
      copySequenceRef.current.count = 0;
      copySequenceRef.current.lastTimestamp = 0;
    });

    const nodesRef = createRef<FlowNode[]>([createNode("node-1"), createNode("node-2")]);
    const edgesRef = createRef<FlowEdge[]>([
      createEdge("edge-1", "node-1", "node-2"),
    ]);
    const selectedNodeIdsRef = createRef<Set<string>>(new Set());
    const selectedEdgeIdsRef = createRef<Set<string>>(new Set());
    const workflowBusyRef = createRef(false);

    renderHook(() =>
      useWorkflowKeyboardShortcuts({
        applySelection,
        copySelectionToClipboard,
        copySequenceRef,
        edgesRef,
        nodesRef,
        pasteClipboardGraph,
        redoHistory,
        removeElements,
        resetCopySequence,
        selectedEdgeIdsRef,
        selectedNodeIdsRef,
        undoHistory,
        workflowBusyRef,
      }),
    );

    const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(applySelection).toHaveBeenCalledWith({
      nodeIds: ["node-1", "node-2"],
      edgeIds: ["edge-1"],
      primaryNodeId: "node-1",
      primaryEdgeId: null,
    });
  });

  it("removes the current selection with Delete", () => {
    const copySelectionToClipboard = vi.fn().mockResolvedValue(true);
    const pasteClipboardGraph = vi.fn().mockResolvedValue(true);
    const applySelection = vi.fn();
    const copySequenceRef = createRef<{ count: number; lastTimestamp: number }>({
      count: 0,
      lastTimestamp: 0,
    });
    const redoHistory = vi.fn().mockReturnValue(false);
    const undoHistory = vi.fn().mockReturnValue(false);
    const removeElements = vi.fn();
    const resetCopySequence = vi.fn(() => {
      copySequenceRef.current.count = 0;
      copySequenceRef.current.lastTimestamp = 0;
    });

    const nodesRef = createRef<FlowNode[]>([createNode("node-1")]);
    const edgesRef = createRef<FlowEdge[]>([]);
    const selectedNodeIdsRef = createRef<Set<string>>(new Set(["node-1"]));
    const selectedEdgeIdsRef = createRef<Set<string>>(new Set());
    const workflowBusyRef = createRef(false);

    renderHook(() =>
      useWorkflowKeyboardShortcuts({
        applySelection,
        copySelectionToClipboard,
        copySequenceRef,
        edgesRef,
        nodesRef,
        pasteClipboardGraph,
        redoHistory,
        removeElements,
        resetCopySequence,
        selectedEdgeIdsRef,
        selectedNodeIdsRef,
        undoHistory,
        workflowBusyRef,
      }),
    );

    const event = new KeyboardEvent("keydown", { key: "Delete", cancelable: true });
    window.dispatchEvent(event);

    expect(removeElements).toHaveBeenCalledWith({
      nodeIds: selectedNodeIdsRef.current,
      edgeIds: selectedEdgeIdsRef.current,
    });
    expect(resetCopySequence).toHaveBeenCalled();
  });

  it("performs undo and redo shortcuts", () => {
    const copySelectionToClipboard = vi.fn().mockResolvedValue(true);
    const pasteClipboardGraph = vi.fn().mockResolvedValue(true);
    const applySelection = vi.fn();
    const copySequenceRef = createRef<{ count: number; lastTimestamp: number }>({
      count: 0,
      lastTimestamp: 0,
    });
    const redoHistory = vi.fn().mockReturnValue(true);
    const undoHistory = vi.fn().mockReturnValue(true);
    const removeElements = vi.fn();
    const resetCopySequence = vi.fn(() => {
      copySequenceRef.current.count = 0;
      copySequenceRef.current.lastTimestamp = 0;
    });

    const nodesRef = createRef<FlowNode[]>([createNode("node-1")]);
    const edgesRef = createRef<FlowEdge[]>([]);
    const selectedNodeIdsRef = createRef<Set<string>>(new Set());
    const selectedEdgeIdsRef = createRef<Set<string>>(new Set());
    const workflowBusyRef = createRef(false);

    renderHook(() =>
      useWorkflowKeyboardShortcuts({
        applySelection,
        copySelectionToClipboard,
        copySequenceRef,
        edgesRef,
        nodesRef,
        pasteClipboardGraph,
        redoHistory,
        removeElements,
        resetCopySequence,
        selectedEdgeIdsRef,
        selectedNodeIdsRef,
        undoHistory,
        workflowBusyRef,
      }),
    );

    const undoEvent = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    window.dispatchEvent(undoEvent);

    expect(undoHistory).toHaveBeenCalledTimes(1);
    expect(redoHistory).not.toHaveBeenCalled();
    expect(undoEvent.defaultPrevented).toBe(true);

    const redoEvent = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(redoEvent);

    expect(redoHistory).toHaveBeenCalledTimes(1);
    expect(redoEvent.defaultPrevented).toBe(true);
  });
});
