import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminSectionKey } from "../config/adminSections";

const STORAGE_KEY = "chatkit-admin-modal-tab";
const DEFAULT_TAB: AdminSectionKey = "users";

/**
 * Custom hook to manage the admin modal state
 * Handles open/closed state, active tab, and scroll position persistence
 */
export const useAdminModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTabInternal] = useState<AdminSectionKey>(() => {
    // Read from localStorage on initial mount
    if (typeof window === "undefined") {
      return DEFAULT_TAB;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return (stored as AdminSectionKey) || DEFAULT_TAB;
    } catch {
      return DEFAULT_TAB;
    }
  });

  // Store scroll positions for each tab
  const scrollPositions = useRef<Record<string, number>>({});

  // Persist active tab to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, activeTab);
    } catch (error) {
    }
  }, [activeTab]);

  const setActiveTab = useCallback((tab: AdminSectionKey) => {
    setActiveTabInternal(tab);
  }, []);

  const openAdmin = useCallback((tab?: AdminSectionKey) => {
    if (tab) {
      setActiveTabInternal(tab);
    }
    setIsOpen(true);
  }, []);

  const closeAdmin = useCallback(() => {
    setIsOpen(false);
  }, []);

  const saveScrollPosition = useCallback((tab: AdminSectionKey, position: number) => {
    scrollPositions.current[tab] = position;
  }, []);

  const getScrollPosition = useCallback((tab: AdminSectionKey): number => {
    return scrollPositions.current[tab] || 0;
  }, []);

  return {
    isOpen,
    activeTab,
    setActiveTab,
    openAdmin,
    closeAdmin,
    saveScrollPosition,
    getScrollPosition,
  };
};
