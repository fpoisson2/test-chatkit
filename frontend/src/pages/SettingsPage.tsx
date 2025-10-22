import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

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

  const handleSelectSection = useCallback(
    (sectionId: SettingsSectionId) => {
      if (sectionId === firstSectionId) {
        setSearchParams({}, { replace: false });
      } else {
        setSearchParams({ section: sectionId }, { replace: false });
      }
    },
    [firstSectionId, setSearchParams],
  );

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <div>
          <h1 className="settings-page__title">{t("settings.page.title")}</h1>
          <p className="settings-page__subtitle">{t("settings.page.subtitle")}</p>
        </div>
      </header>
      <div className="settings-page__body">
        <nav className="settings-page__sidebar" aria-label={t("settings.page.navLabel")}>
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
        <div className="settings-page__main">
          {activeSection?.id === "preferences" ? (
            <SettingsPreferencesSection key={activeSection.id} activeSection={activeSection} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
