import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { useI18n } from "../../i18n";
import type { SettingsSection } from "./sections";

export type SettingsPreferencesSectionProps = {
  activeSection: SettingsSection;
  hideHeader?: boolean;
};

export function SettingsPreferencesSection({
  activeSection,
  hideHeader = false,
}: SettingsPreferencesSectionProps) {
  const { t } = useI18n();
  const sectionTitleId = "settings-section-preferences-title";

  return (
    <section
      key="preferences"
      className="settings-page__section"
      aria-labelledby={hideHeader ? undefined : sectionTitleId}
      aria-label={hideHeader ? activeSection.label : undefined}
      id={`settings-section-${activeSection.id}`}
    >
      {hideHeader ? null : (
        <header className="settings-page__section-header">
          <h3 id={sectionTitleId} className="settings-page__section-title">
            {activeSection.label}
          </h3>
          <p className="settings-page__section-description">{activeSection.description}</p>
        </header>
      )}
      <div className="settings-page__section-body">
        <div className="settings-page__card">
          <h4 className="settings-page__card-title">{t("settings.preferences.language.title")}</h4>
          <p className="settings-page__card-description">
            {t("settings.preferences.language.description")}
          </p>
          <LanguageSwitcher
            id="settings-language"
            hideLabel={false}
            label={t("settings.preferences.language.label")}
            className="label settings-preferences__field"
            selectClassName="input"
          />
          <p className="settings-preferences__hint">
            {t("settings.preferences.language.hint")}
          </p>
        </div>
      </div>
    </section>
  );
}
