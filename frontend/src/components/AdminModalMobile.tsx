import { Suspense, useCallback, useEffect, useRef } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";

import { ADMIN_SECTIONS, type AdminSectionKey } from "../config/adminSections";
import { useI18n } from "../i18n";
import { LoadingSpinner } from "./LoadingSpinner";

type AdminModalMobileProps = {
  activeTab: AdminSectionKey;
  setActiveTab: (tab: AdminSectionKey) => void;
  saveScrollPosition: (tab: AdminSectionKey, position: number) => void;
  getScrollPosition: (tab: AdminSectionKey) => number;
};

export const AdminModalMobile = ({
  activeTab,
  setActiveTab,
  saveScrollPosition,
  getScrollPosition,
}: AdminModalMobileProps) => {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Debug: Log number of sections
  useEffect(() => {
  }, []);

  // Save scroll position when switching tabs
  const handleTabChange = useCallback(
    (newTab: AdminSectionKey) => {
      // Save current scroll position
      if (contentRef.current) {
        saveScrollPosition(activeTab, contentRef.current.scrollTop);
      }

      // Switch to new tab
      setActiveTab(newTab);

      // Scroll to top of new content
      if (contentRef.current) {
        contentRef.current.scrollTop = 0;
      }
    },
    [activeTab, saveScrollPosition, setActiveTab],
  );

  // Restore scroll position when tab changes
  useEffect(() => {
    if (contentRef.current) {
      const savedPosition = getScrollPosition(activeTab);
      contentRef.current.scrollTop = savedPosition;
    }
  }, [activeTab, getScrollPosition]);

  const activeSection = ADMIN_SECTIONS.find((s) => s.key === activeTab);
  const SectionComponent = activeSection?.Component;

  return (
    <div className="admin-modal__mobile">
      <div className="admin-modal__select-wrapper">
        <Select.Root value={activeTab} onValueChange={handleTabChange}>
          <Select.Trigger className="admin-modal__select-trigger" aria-label="Sélectionner une section">
            <Select.Value>
              {activeSection ? t(activeSection.labelKey) : ""}
            </Select.Value>
            <Select.Icon className="admin-modal__select-icon">
              <ChevronDown size={16} />
            </Select.Icon>
          </Select.Trigger>

          <Select.Portal>
            <Select.Content
              className="admin-modal__select-content"
              position="popper"
              sideOffset={5}
              collisionPadding={20}
            >
              <Select.Viewport className="admin-modal__select-viewport">
                {ADMIN_SECTIONS.map((section) => (
                  <Select.Item
                    key={section.key}
                    value={section.key}
                    className="admin-modal__select-item"
                  >
                    <Select.ItemText>{t(section.labelKey)}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="admin-modal__mobile-content" ref={contentRef}>
        <Suspense
          fallback={
            <div className="admin-modal__loading">
              <LoadingSpinner />
            </div>
          }
        >
          {SectionComponent && <SectionComponent />}
        </Suspense>
      </div>
    </div>
  );
};
