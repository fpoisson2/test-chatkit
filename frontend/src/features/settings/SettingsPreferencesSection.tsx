import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { useI18n } from "../../i18n";
import type { SettingsSection } from "./sections";

export type SettingsPreferencesSectionProps = {
  activeSection: SettingsSection;
};

export function SettingsPreferencesSection({ activeSection }: SettingsPreferencesSectionProps) {
  const { t } = useI18n();

  return (
    <section
      key="preferences"
      className="settings-modal__section"
      aria-labelledby="settings-section-preferences-title"
      id="settings-section-preferences"
    >
      <header className="settings-modal__section-header">
        <h3 id="settings-section-preferences-title" className="settings-modal__section-title">
          {activeSection.label}
        </h3>
        <p className="settings-modal__section-description">{activeSection.description}</p>
      </header>
      <div className="settings-modal__section-body">
        <div className="settings-modal__card">
          <h4 className="settings-modal__card-title">{t("settings.preferences.language.title")}</h4>
          <p className="settings-modal__card-description">
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
