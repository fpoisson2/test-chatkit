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
      className="admin-card"
      aria-labelledby={hideHeader ? undefined : sectionTitleId}
      aria-label={hideHeader ? activeSection.label : undefined}
      id={`settings-section-${activeSection.id}`}
    >
      {hideHeader ? null : (
        <div>
          <h2 id={sectionTitleId} className="admin-card__title">
            {activeSection.label}
          </h2>
          <p className="admin-card__subtitle">{activeSection.description}</p>
        </div>
      )}
      <div className="admin-form">
        <div>
          <h3 className="admin-card__title">
            {t("settings.preferences.language.title")}
          </h3>
          <p className="admin-card__subtitle">
            {t("settings.preferences.language.description")}
          </p>
        </div>
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
    </section>
  );
}
