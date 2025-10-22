import type { ChangeEvent } from "react";

import { useI18n } from "../i18n";

export const LanguageSwitcher = ({ tabIndex }: { tabIndex?: number }) => {
  const { language, setLanguage, availableLanguages, t } = useI18n();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setLanguage(event.target.value as typeof language);
  };

  return (
    <label className="language-switcher">
      <span className="visually-hidden">{t("language.switcher.label")}</span>
      <select
        className="language-switcher__select"
        value={language}
        onChange={handleChange}
        tabIndex={tabIndex}
      >
        {availableLanguages.map((item) => (
          <option key={item.code} value={item.code}>
            {t(`language.name.${item.code}`)}
          </option>
        ))}
      </select>
    </label>
  );
};

export default LanguageSwitcher;
