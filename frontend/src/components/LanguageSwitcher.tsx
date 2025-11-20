import type { ChangeEvent } from "react";

import { useI18n } from "../i18n";

export type LanguageSwitcherProps = {
  id?: string;
  tabIndex?: number;
  label?: string;
  hideLabel?: boolean;
  className?: string;
  labelClassName?: string;
  selectClassName?: string;
};

export const LanguageSwitcher = ({
  id,
  tabIndex,
  label,
  hideLabel = true,
  className,
  labelClassName,
  selectClassName,
}: LanguageSwitcherProps) => {
  const { language, setLanguage, availableLanguages, t } = useI18n();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setLanguage(event.target.value as typeof language);
  };

  const resolvedLabel = label ?? t("language.switcher.label");
  const resolvedRootClassName = className ?? "language-switcher";
  const resolvedSelectClassName = selectClassName ?? "language-switcher__select";
  const resolvedLabelClassName = hideLabel ? "visually-hidden" : labelClassName;

  return (
    <label className={resolvedRootClassName}>
      <span className={resolvedLabelClassName ?? undefined}>{resolvedLabel}</span>
      <select
        id={id}
        className={resolvedSelectClassName}
        value={language}
        onChange={handleChange}
        tabIndex={tabIndex}
      >
        {availableLanguages.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
};

export default LanguageSwitcher;
