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
      className="card"
      aria-labelledby={hideHeader ? undefined : sectionTitleId}
      aria-label={hideHeader ? activeSection.label : undefined}
      id={`settings-section-${activeSection.id}`}
    >
      {hideHeader ? null : (
        <div className="card-header">
          <h2 id={sectionTitleId} className="card-title">
            {activeSection.label}
          </h2>
          <p className="card-subtitle">{activeSection.description}</p>
        </div>
      )}
      <div className="card-body flex flex-col gap-6">
        <div>
          <h3 className="card-title">
            {t("settings.preferences.language.title")}
          </h3>
          <p className="card-subtitle">
            {t("settings.preferences.language.description")}
          </p>
        </div>
        <div className="form-group">
          <LanguageSwitcher
            id="settings-language"
            hideLabel={false}
            label={t("settings.preferences.language.label")}
            className="form-label"
            selectClassName="input"
          />
        </div>
        <p className="form-hint">
          {t("settings.preferences.language.hint")}
        </p>
      </div>
    </section>
  );
}
