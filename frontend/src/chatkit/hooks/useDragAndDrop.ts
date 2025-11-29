import { useState, useRef, useCallback, DragEvent } from 'react';

export interface UseDragAndDropOptions {
  /** Whether drag-and-drop is enabled */
  enabled: boolean;
  /** Callback when files are dropped */
  onFilesDropped: (files: FileList) => void;
}

export interface UseDragAndDropReturn {
  isDraggingFiles: boolean;
  dragHandlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * Hook to manage drag-and-drop file uploads.
 * Tracks drag state and handles file drops.
 */
export function useDragAndDrop({
  enabled,
  onFilesDropped,
}: UseDragAndDropOptions): UseDragAndDropReturn {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (!enabled) return;

      dragCounterRef.current += 1;
      if (e.dataTransfer.types.includes('Files')) {
        setIsDraggingFiles(true);
      }
    },
    [enabled]
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (!enabled) return;

      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsDraggingFiles(false);
      }
    },
    [enabled]
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      // No additional logic needed, but required for drop to work
    },
    []
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (!enabled) return;

      dragCounterRef.current = 0;
      setIsDraggingFiles(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFilesDropped(e.dataTransfer.files);
      }
    },
    [enabled, onFilesDropped]
  );

  return {
    isDraggingFiles,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  };
}
