import { Suspense, useCallback, useEffect, useRef } from "react";
import * as Tabs from "@radix-ui/react-tabs";

import {
  ADMIN_SECTIONS,
  ADMIN_GROUPS,
  type AdminSectionKey,
} from "../config/adminSections";
import { useI18n } from "../i18n";
import { LoadingSpinner } from "./LoadingSpinner";

type AdminModalDesktopProps = {
  activeTab: AdminSectionKey;
  setActiveTab: (tab: AdminSectionKey) => void;
  saveScrollPosition: (tab: AdminSectionKey, position: number) => void;
  getScrollPosition: (tab: AdminSectionKey) => number;
};

export const AdminModalDesktop = ({
  activeTab,
  setActiveTab,
  saveScrollPosition,
  getScrollPosition,
}: AdminModalDesktopProps) => {
  const { t } = useI18n();
  const contentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Save scroll position when switching tabs
  const handleTabChange = useCallback(
    (newTab: string) => {
      // Save current tab's scroll position
      const currentContent = contentRefs.current[activeTab];
      if (currentContent) {
        saveScrollPosition(activeTab, currentContent.scrollTop);
      }

      // Switch to new tab
      setActiveTab(newTab as AdminSectionKey);
    },
    [activeTab, saveScrollPosition, setActiveTab],
  );

  // Restore scroll position when tab content is mounted
  useEffect(() => {
    const currentContent = contentRefs.current[activeTab];
    if (currentContent) {
      const savedPosition = getScrollPosition(activeTab);
      currentContent.scrollTop = savedPosition;
    }
  }, [activeTab, getScrollPosition]);

  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={handleTabChange}
      className="admin-modal__desktop"
      orientation="vertical"
    >
      <div className="admin-modal__sidebar">
        <Tabs.List
          className="admin-modal__tabs-list"
          aria-label={t("admin.tabs.navigationLabel")}
        >
          {ADMIN_GROUPS.map((group) => {
            // Only render group if at least one section is available
            // (Usefull if we implement permission checks per section later)
            const availableSections = group.sections.filter((sectionKey) => {
              return ADMIN_SECTIONS.find((s) => s.key === sectionKey);
            });

            if (availableSections.length === 0) return null;

            return (
              <div key={group.key} className="admin-modal__group">
                <div className="admin-modal__group-title">
                  {t(group.labelKey)}
                </div>
                {availableSections.map((sectionKey) => {
                  const section = ADMIN_SECTIONS.find(
                    (s) => s.key === sectionKey,
                  );
                  if (!section) return null;

                  return (
                    <Tabs.Trigger
                      key={section.key}
                      value={section.key}
                      className="admin-modal__tab-trigger"
                    >
                      {t(section.labelKey)}
                    </Tabs.Trigger>
                  );
                })}
              </div>
            );
          })}
        </Tabs.List>
      </div>

      <div className="admin-modal__content-wrapper">
        {ADMIN_SECTIONS.map((section) => {
          const SectionComponent = section.Component;

          return (
            <Tabs.Content
              key={section.key}
              value={section.key}
              className="admin-modal__tab-content"
              ref={(el) => {
                contentRefs.current[section.key] = el;
              }}
            >
              <Suspense
                fallback={
                  <div className="admin-modal__loading">
                    <LoadingSpinner />
                  </div>
                }
              >
                <SectionComponent />
              </Suspense>
            </Tabs.Content>
          );
        })}
      </div>
    </Tabs.Root>
  );
};
