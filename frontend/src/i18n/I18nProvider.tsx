import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AVAILABLE_LANGUAGES, translations, type Language } from "./translations";

type TranslationParams = Record<string, string | number | boolean>;

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: TranslationParams) => string;
  availableLanguages: typeof AVAILABLE_LANGUAGES;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const LANGUAGE_STORAGE_KEY = "chatkit.language";

const normalizeLanguage = (value: string | null | undefined): Language => {
  if (!value) {
    return "en";
  }

  const normalized = value.toLowerCase();
  if (normalized.startsWith("fr")) {
    return "fr";
  }
  return "en";
};

const detectInitialLanguage = (): Language => {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) {
      return normalizeLanguage(stored);
    }
  } catch (error) {
    console.warn("Unable to access language preference storage", error);
  }

  if (typeof navigator !== "undefined") {
    const [primary] = navigator.languages ?? [navigator.language];
    if (primary) {
      return normalizeLanguage(primary);
    }
  }

  return "en";
};

const interpolate = (template: string, params: TranslationParams | undefined): string => {
  if (!params) {
    return template;
  }

  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key: string) => {
    const value = params[key];
    return value == null ? "" : String(value);
  });
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
      console.warn("Unable to persist language preference", error);
    }
  }, [language]);

  const translate = useCallback(
    (key: string, params?: TranslationParams) => {
      const dictionary = translations[language];
      const fallbackDictionary = translations.en;
      const template = dictionary[key] ?? fallbackDictionary[key] ?? key;
      return interpolate(template, params);
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: translate,
      availableLanguages: AVAILABLE_LANGUAGES,
    }),
    [language, translate],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};
