import { useEffect } from "react";
import type { MutableRefObject } from "react";

import type { FlowEdge, FlowNode } from "../types";

type ApplySelectionArgs = {
  nodeIds?: Iterable<string>;
  edgeIds?: Iterable<string>;
  primaryNodeId?: string | null;
  primaryEdgeId?: string | null;
};

type RemoveElementsArgs = {
  nodeIds?: Iterable<string>;
  edgeIds?: Iterable<string>;
};

type UseWorkflowKeyboardShortcutsParams = {
  applySelection: (args: ApplySelectionArgs) => void;
  copySelectionToClipboard: (args?: { includeEntireGraph?: boolean }) => Promise<unknown>;
  pasteClipboardGraph: () => Promise<unknown>;
  redoHistory: () => boolean;
  undoHistory: () => boolean;
  removeElements: (args: RemoveElementsArgs) => void;
  nodesRef: MutableRefObject<FlowNode[]>;
  edgesRef: MutableRefObject<FlowEdge[]>;
  selectedNodeIdsRef: MutableRefObject<Set<string>>;
  selectedEdgeIdsRef: MutableRefObject<Set<string>>;
  copySequenceRef: MutableRefObject<{ count: number; lastTimestamp: number }>;
  resetCopySequence: () => void;
  workflowBusyRef: MutableRefObject<boolean>;
};

export const useWorkflowKeyboardShortcuts = ({
  applySelection,
  copySelectionToClipboard,
  pasteClipboardGraph,
  redoHistory,
  undoHistory,
  removeElements,
  nodesRef,
  edgesRef,
  selectedNodeIdsRef,
  selectedEdgeIdsRef,
  copySequenceRef,
  resetCopySequence,
  workflowBusyRef,
}: UseWorkflowKeyboardShortcutsParams) => {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      if (target.isContentEditable) {
        return true;
      }
      const tagName = target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return true;
      }
      return target.closest('input, textarea, [contenteditable="true"]') !== null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isCtrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const now = Date.now();
      const workflowBusy = workflowBusyRef.current;

      if (isCtrlOrMeta && key === "c") {
        const previousTimestamp = copySequenceRef.current.lastTimestamp;
        const previousCount = copySequenceRef.current.count;
        const nextCount =
          previousTimestamp && now - previousTimestamp <= 600 ? previousCount + 1 : 1;
        copySequenceRef.current.count = nextCount;
        copySequenceRef.current.lastTimestamp = now;

        if (workflowBusy) {
          return;
        }

        if (isEditableTarget(event.target) && nextCount < 2) {
          return;
        }

        event.preventDefault();
        void copySelectionToClipboard({ includeEntireGraph: nextCount >= 2 });
        return;
      }

      const allowDueToCopySequence =
        copySequenceRef.current.count >= 2 &&
        now - copySequenceRef.current.lastTimestamp <= 800;

      if (isEditableTarget(event.target) && !allowDueToCopySequence) {
        if (!isCtrlOrMeta) {
          resetCopySequence();
        }
        return;
      }

      if (isCtrlOrMeta && key === "z") {
        if (workflowBusy) {
          return;
        }
        const performed = event.shiftKey ? redoHistory() : undoHistory();
        if (performed) {
          event.preventDefault();
          resetCopySequence();
        }
        return;
      }

      if (isCtrlOrMeta && key === "y") {
        if (workflowBusy) {
          return;
        }
        const performed = redoHistory();
        if (performed) {
          event.preventDefault();
          resetCopySequence();
        }
        return;
      }

      if (isCtrlOrMeta && key === "a") {
        if (workflowBusy) {
          return;
        }
        event.preventDefault();
        const allNodeIds = nodesRef.current.map((node) => node.id);
        const allEdgeIds = edgesRef.current.map((edge) => edge.id);
        const primaryNodeId = allNodeIds[0] ?? null;
        const primaryEdgeId = primaryNodeId ? null : allEdgeIds[0] ?? null;
        applySelection({
          nodeIds: allNodeIds,
          edgeIds: allEdgeIds,
          primaryNodeId,
          primaryEdgeId,
        });
        resetCopySequence();
        return;
      }

      if (isCtrlOrMeta && key === "v") {
        if (workflowBusy) {
          return;
        }
        event.preventDefault();
        void pasteClipboardGraph().finally(() => {
          resetCopySequence();
        });
        return;
      }

      if (event.key === "Delete") {
        const hasSelection =
          selectedNodeIdsRef.current.size > 0 || selectedEdgeIdsRef.current.size > 0;
        if (!hasSelection) {
          resetCopySequence();
          return;
        }
        event.preventDefault();
        removeElements({
          nodeIds: selectedNodeIdsRef.current,
          edgeIds: selectedEdgeIdsRef.current,
        });
        resetCopySequence();
        return;
      }

      if (!isCtrlOrMeta) {
        resetCopySequence();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
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
  ]);
};
