import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { AdminTabs } from "../components/AdminTabs";
import { Modal } from "../components/Modal";
import { useI18n } from "../i18n";
import {
  DEFAULT_SETTINGS_SECTION_ID,
  buildSettingsSections,
  type SettingsSectionId,
} from "../features/settings/sections";
import { SettingsPreferencesSection } from "../features/settings/SettingsPreferencesSection";

export function SettingsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isModalOpen, setModalOpen] = useState(false);

  const sections = useMemo(() => buildSettingsSections(t), [t]);
  const requestedSection = searchParams.get("section") as SettingsSectionId | null;
  const firstSectionId = sections[0]?.id ?? DEFAULT_SETTINGS_SECTION_ID;
  const activeSectionId = sections.some((section) => section.id === requestedSection)
    ? (requestedSection as SettingsSectionId)
    : firstSectionId;

  useEffect(() => {
    if (requestedSection && requestedSection !== activeSectionId) {
      if (activeSectionId === firstSectionId) {
        setSearchParams({}, { replace: true });
      } else {
        setSearchParams({ section: activeSectionId }, { replace: true });
      }
    }
  }, [activeSectionId, firstSectionId, requestedSection, setSearchParams]);

  const scrollToSection = useCallback((sectionId: SettingsSectionId) => {
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`settings-section-${sectionId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, []);

  useEffect(() => {
    if (!requestedSection) {
      return;
    }
    scrollToSection(activeSectionId);
  }, [activeSectionId, requestedSection, scrollToSection]);

  const handleSelectSection = useCallback(
    (sectionId: SettingsSectionId) => {
      if (sectionId === firstSectionId) {
        setSearchParams({}, { replace: false });
      } else {
        setSearchParams({ section: sectionId }, { replace: false });
      }
      setModalOpen(false);
      scrollToSection(sectionId);
    },
    [firstSectionId, scrollToSection, setSearchParams],
  );

  const handleOpenModal = useCallback(() => {
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  return (
    <ManagementPageLayout
      tabs={<AdminTabs activeTab="preferences" />}
    >
        <div className="admin-grid">
          {activeSection?.id === "preferences" ? (
            <SettingsPreferencesSection
              key={activeSection.id}
              activeSection={activeSection}
            />
          ) : null}
        </div>

      {isModalOpen ? (
        <Modal
          title={t("settings.modal.title")}
          onClose={handleCloseModal}
          footer={
            <button
              type="button"
              className="button button--ghost"
              onClick={handleCloseModal}
            >
              {t("settings.modal.close")}
            </button>
          }
        >
          <nav className="settings-page__modal-nav" aria-label={t("settings.modal.navLabel")}>
            <ul className="settings-page__nav">
              {sections.map((section) => {
                const isActive = section.id === activeSectionId;
                return (
                  <li key={section.id} className="settings-page__nav-item">
                    <button
                      type="button"
                      className={`settings-page__nav-button${
                        isActive ? " settings-page__nav-button--active" : ""
                      }`}
                      onClick={() => handleSelectSection(section.id)}
                      aria-current={isActive ? "page" : undefined}
                      aria-controls={`settings-section-${section.id}`}
                    >
                      {section.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </Modal>
      ) : null}
    </ManagementPageLayout>
  );
}

export default SettingsPage;
