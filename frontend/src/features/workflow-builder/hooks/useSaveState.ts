import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveState } from "../types";

interface UseSaveStateReturn {
  // State
  saveState: SaveState;
  saveMessage: string | null;
  hasPendingChanges: boolean;
  loading: boolean;
  loadError: string | null;

  // Refs
  hasPendingChangesRef: React.MutableRefObject<boolean>;
  saveStateRef: React.MutableRefObject<SaveState>;
  autoSaveTimeoutRef: React.MutableRefObject<number | null>;
  lastSavedSnapshotRef: React.MutableRefObject<string | null>;
  isCreatingDraftRef: React.MutableRefObject<boolean>;
  isHydratingRef: React.MutableRefObject<boolean>;

  // Setters
  setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
  setSaveMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setHasPendingChanges: React.Dispatch<React.SetStateAction<boolean>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadError: React.Dispatch<React.SetStateAction<string | null>>;

  // Actions
  updateHasPendingChanges: (value: boolean | ((previous: boolean) => boolean)) => void;
}

interface UseSaveStateOptions {
  initialLoading?: boolean;
}

/**
 * Hook to manage save state, including autosave timing and pending changes tracking.
 */
export const useSaveState = ({
  initialLoading = true,
}: UseSaveStateOptions = {}): UseSaveStateReturn => {
  const [loading, setLoading] = useState(initialLoading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  const hasPendingChangesRef = useRef(hasPendingChanges);
  const saveStateRef = useRef<SaveState>(saveState);
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const isCreatingDraftRef = useRef(false);
  const isHydratingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    hasPendingChangesRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  const updateHasPendingChanges = useCallback(
    (value: boolean | ((previous: boolean) => boolean)) => {
      setHasPendingChanges(value);
    },
    [],
  );

  return {
    saveState,
    saveMessage,
    hasPendingChanges,
    loading,
    loadError,
    hasPendingChangesRef,
    saveStateRef,
    autoSaveTimeoutRef,
    lastSavedSnapshotRef,
    isCreatingDraftRef,
    isHydratingRef,
    setSaveState,
    setSaveMessage,
    setHasPendingChanges,
    setLoading,
    setLoadError,
    updateHasPendingChanges,
  };
};
