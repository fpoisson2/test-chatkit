import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { SaveState } from "../types";

// Context types
type SaveContextValue = {
  // State
  saveState: SaveState;
  saveMessage: string | null;
  lastSavedSnapshot: string;

  // Refs
  saveStateRef: React.MutableRefObject<SaveState>;
  lastSavedSnapshotRef: React.MutableRefObject<string>;

  // Methods
  setSaveState: (state: SaveState) => void;
  setSaveMessage: (message: string | null) => void;
  setLastSavedSnapshot: (snapshot: string) => void;
  markAsSaving: () => void;
  markAsSaved: (message?: string) => void;
  markAsError: (message: string) => void;
  markAsIdle: () => void;
  resetSaveState: () => void;
};

const SaveContext = createContext<SaveContextValue | null>(null);

export const useSaveContext = () => {
  const context = useContext(SaveContext);
  if (!context) {
    throw new Error("useSaveContext must be used within SaveProvider");
  }
  return context;
};

type SaveProviderProps = {
  children: ReactNode;
};

export const SaveProvider = ({ children }: SaveProviderProps) => {
  // State
  const [saveState, setSaveStateValue] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshotValue] = useState<string>("");

  // Refs for synchronization
  const saveStateRef = useRef<SaveState>("idle");
  const lastSavedSnapshotRef = useRef<string>("");

  // Sync refs with state
  saveStateRef.current = saveState;
  lastSavedSnapshotRef.current = lastSavedSnapshot;

  // Enhanced setters
  const setSaveState = useCallback((state: SaveState) => {
    setSaveStateValue(state);
  }, []);

  const setLastSavedSnapshot = useCallback((snapshot: string) => {
    setLastSavedSnapshotValue(snapshot);
  }, []);

  // Mark as saving
  const markAsSaving = useCallback(() => {
    setSaveState("saving");
    setSaveMessage(null);
  }, [setSaveState]);

  // Mark as saved with optional message
  const markAsSaved = useCallback(
    (message?: string) => {
      setSaveState("saved");
      if (message) {
        setSaveMessage(message);
      }
    },
    [setSaveState],
  );

  // Mark as error with message
  const markAsError = useCallback(
    (message: string) => {
      setSaveState("error");
      setSaveMessage(message);
    },
    [setSaveState],
  );

  // Mark as idle
  const markAsIdle = useCallback(() => {
    setSaveState("idle");
    setSaveMessage(null);
  }, [setSaveState]);

  // Reset save state completely
  const resetSaveState = useCallback(() => {
    setSaveState("idle");
    setSaveMessage(null);
  }, [setSaveState]);

  const value = useMemo<SaveContextValue>(
    () => ({
      // State
      saveState,
      saveMessage,
      lastSavedSnapshot,

      // Refs
      saveStateRef,
      lastSavedSnapshotRef,

      // Methods
      setSaveState,
      setSaveMessage,
      setLastSavedSnapshot,
      markAsSaving,
      markAsSaved,
      markAsError,
      markAsIdle,
      resetSaveState,
    }),
    [saveState, saveMessage, lastSavedSnapshot, setSaveState, markAsSaving, markAsSaved, markAsError, markAsIdle, resetSaveState],
  );

  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
};
