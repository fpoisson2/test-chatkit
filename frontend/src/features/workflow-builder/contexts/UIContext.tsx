import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { DeviceType } from "../WorkflowBuilderUtils";

// Context types
export type CloseBlockLibraryOptions = {
  focusToggle?: boolean;
};

type UIContextValue = {
  // State
  isBlockLibraryOpen: boolean;
  isPropertiesPanelOpen: boolean;
  isMobileLayout: boolean;
  deviceType: DeviceType;
  isExporting: boolean;
  isImporting: boolean;

  // Block Library Methods
  toggleBlockLibrary: () => void;
  openBlockLibrary: () => void;
  closeBlockLibrary: (options?: CloseBlockLibraryOptions) => void;
  setIsBlockLibraryOpen: (open: boolean) => void;
  registerBlockLibraryToggle: (element: HTMLButtonElement | null) => void;

  // Properties Panel Methods
  togglePropertiesPanel: () => void;
  openPropertiesPanel: () => void;
  closePropertiesPanel: () => void;
  setIsPropertiesPanelOpen: (open: boolean) => void;

  // Layout Methods
  setIsMobileLayout: (mobile: boolean) => void;
  setDeviceType: (deviceType: DeviceType) => void;

  // Import/Export Methods
  setIsExporting: (isExporting: boolean) => void;
  setIsImporting: (isImporting: boolean) => void;
};

const UIContext = createContext<UIContextValue | null>(null);

export const useUIContext = () => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error("useUIContext must be used within UIProvider");
  }
  return context;
};

type UIProviderProps = {
  children: ReactNode;
};

export const UIProvider = ({ children }: UIProviderProps) => {
  // State
  const [isBlockLibraryOpen, setIsBlockLibraryOpen] = useState(false);
  const [isPropertiesPanelOpen, setIsPropertiesPanelOpen] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>("desktop");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const blockLibraryToggleRef = useRef<HTMLButtonElement | null>(null);

  // Block Library Methods
  const toggleBlockLibrary = useCallback(() => {
    setIsBlockLibraryOpen((prev) => !prev);
  }, []);

  const openBlockLibrary = useCallback(() => {
    setIsBlockLibraryOpen(true);
  }, []);

  const closeBlockLibrary = useCallback(
    (options: CloseBlockLibraryOptions = {}) => {
      setIsBlockLibraryOpen(false);
      if (options.focusToggle && blockLibraryToggleRef.current) {
        blockLibraryToggleRef.current.focus();
      }
    },
    [],
  );

  const registerBlockLibraryToggle = useCallback((element: HTMLButtonElement | null) => {
    blockLibraryToggleRef.current = element;
  }, []);

  // Properties Panel Methods
  const togglePropertiesPanel = useCallback(() => {
    setIsPropertiesPanelOpen((prev) => !prev);
  }, []);

  const openPropertiesPanel = useCallback(() => {
    setIsPropertiesPanelOpen(true);
  }, []);

  const closePropertiesPanel = useCallback(() => {
    setIsPropertiesPanelOpen(false);
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({
      // State
      isBlockLibraryOpen,
      isPropertiesPanelOpen,
      isMobileLayout,
      deviceType,
      isExporting,
      isImporting,

      // Block Library Methods
      toggleBlockLibrary,
      openBlockLibrary,
      closeBlockLibrary,
      setIsBlockLibraryOpen,
      registerBlockLibraryToggle,

      // Properties Panel Methods
      togglePropertiesPanel,
      openPropertiesPanel,
      closePropertiesPanel,
      setIsPropertiesPanelOpen,

      // Layout Methods
      setIsMobileLayout,
      setDeviceType,

      // Import/Export Methods
      setIsExporting,
      setIsImporting,
    }),
    [
      isBlockLibraryOpen,
      isPropertiesPanelOpen,
      isMobileLayout,
      deviceType,
      isExporting,
      isImporting,
      toggleBlockLibrary,
      openBlockLibrary,
      closeBlockLibrary,
      registerBlockLibraryToggle,
      togglePropertiesPanel,
      openPropertiesPanel,
      closePropertiesPanel,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
