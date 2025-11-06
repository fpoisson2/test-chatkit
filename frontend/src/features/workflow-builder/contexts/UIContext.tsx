import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { DeviceType } from "../WorkflowBuilderUtils";

// Context types
type UIContextValue = {
  // State
  isBlockLibraryOpen: boolean;
  isPropertiesPanelOpen: boolean;
  isMobileLayout: boolean;
  deviceType: DeviceType;
  openWorkflowMenuId: string | number | null;

  // Block Library Methods
  toggleBlockLibrary: () => void;
  openBlockLibrary: () => void;
  closeBlockLibrary: (returnFocus?: boolean) => void;
  setIsBlockLibraryOpen: (open: boolean) => void;

  // Properties Panel Methods
  togglePropertiesPanel: () => void;
  openPropertiesPanel: () => void;
  closePropertiesPanel: () => void;
  setIsPropertiesPanelOpen: (open: boolean) => void;

  // Layout Methods
  setIsMobileLayout: (mobile: boolean) => void;
  setDeviceType: (deviceType: DeviceType) => void;

  // Workflow Menu Methods
  openWorkflowMenu: (id: string | number) => void;
  closeWorkflowMenu: () => void;
  setOpenWorkflowMenuId: (id: string | number | null) => void;
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
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);

  // Block Library Methods
  const toggleBlockLibrary = useCallback(() => {
    setIsBlockLibraryOpen((prev) => !prev);
  }, []);

  const openBlockLibrary = useCallback(() => {
    setIsBlockLibraryOpen(true);
  }, []);

  const closeBlockLibrary = useCallback((returnFocus: boolean = false) => {
    setIsBlockLibraryOpen(false);
    // returnFocus can be used to manage focus restoration
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

  // Workflow Menu Methods
  const openWorkflowMenu = useCallback((id: string | number) => {
    setOpenWorkflowMenuId(id);
  }, []);

  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({
      // State
      isBlockLibraryOpen,
      isPropertiesPanelOpen,
      isMobileLayout,
      deviceType,
      openWorkflowMenuId,

      // Block Library Methods
      toggleBlockLibrary,
      openBlockLibrary,
      closeBlockLibrary,
      setIsBlockLibraryOpen,

      // Properties Panel Methods
      togglePropertiesPanel,
      openPropertiesPanel,
      closePropertiesPanel,
      setIsPropertiesPanelOpen,

      // Layout Methods
      setIsMobileLayout,
      setDeviceType,

      // Workflow Menu Methods
      openWorkflowMenu,
      closeWorkflowMenu,
      setOpenWorkflowMenuId,
    }),
    [
      isBlockLibraryOpen,
      isPropertiesPanelOpen,
      isMobileLayout,
      deviceType,
      openWorkflowMenuId,
      toggleBlockLibrary,
      openBlockLibrary,
      closeBlockLibrary,
      togglePropertiesPanel,
      openPropertiesPanel,
      closePropertiesPanel,
      openWorkflowMenu,
      closeWorkflowMenu,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
