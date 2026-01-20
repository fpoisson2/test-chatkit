import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AVAILABLE_LANGUAGES,
  translations,
  type Language,
  updateAvailableLanguages,
  addTranslations,
  BASE_LANGUAGES,
} from "./translations";

type TranslationParams = Record<string, string | number | boolean>;

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: TranslationParams) => string;
  availableLanguages: { code: string; label: string }[];
  isLoading: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const LANGUAGE_STORAGE_KEY = "chatkit.language";

// Cache des traductions chargées
const translationsCache = new Set<string>(BASE_LANGUAGES as unknown as string[]);

const resolveLanguage = (value: string | null | undefined): Language | null => {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();

  // Vérifier si le code exact existe
  const exactMatch = AVAILABLE_LANGUAGES.find(
    (lang) => lang.code.toLowerCase() === normalized
  );
  if (exactMatch) {
    return exactMatch.code;
  }

  // Sinon, chercher un préfixe (ex: "fr-CA" → "fr")
  const prefixMatch = AVAILABLE_LANGUAGES.find((lang) =>
    normalized.startsWith(lang.code.toLowerCase())
  );
  if (prefixMatch) {
    return prefixMatch.code;
  }

  return null;
};

const detectInitialLanguage = (): Language => {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const storedLanguage = resolveLanguage(stored);
    if (storedLanguage) {
      return storedLanguage;
    }
  } catch (error) {
  }

  if (typeof navigator !== "undefined") {
    const candidates = navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];

    for (const candidate of candidates) {
      const resolved = resolveLanguage(candidate);
      if (resolved) {
        return resolved;
      }
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

// Fonction pour charger les langues disponibles depuis l'API
const fetchAvailableLanguages = async () => {
  try {
    const response = await fetch("/api/languages");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (Array.isArray(data.languages) && data.languages.length > 0) {
      const normalized = data.languages.map((item: { code: string; name?: string; label?: string }) => ({
        code: item.code,
        label: item.label ?? item.name ?? item.code,
      }));
      updateAvailableLanguages(normalized);
    }
  } catch (error) {
  }
};

// Fonction pour charger les traductions d'une langue depuis l'API
const fetchLanguageTranslations = async (code: string) => {
  // Si c'est une langue de base ou déjà chargée, ne rien faire
  if (translationsCache.has(code)) {
    return;
  }

  try {
    const response = await fetch(`/api/languages/${code}/translations`);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.translations && Object.keys(data.translations).length > 0) {
      addTranslations(code, data.translations);
      translationsCache.add(code);
    }
  } catch (error) {
  }
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());
  const [isLoading, setIsLoading] = useState(true);
  const [availableLangs, setAvailableLangs] = useState(AVAILABLE_LANGUAGES);

  // Charger les langues disponibles au démarrage
  useEffect(() => {
    const loadLanguages = async () => {
      await fetchAvailableLanguages();
      setAvailableLangs([...AVAILABLE_LANGUAGES]);
      setIsLoading(false);
    };
    loadLanguages();
  }, []);

  // Sauvegarder la langue sélectionnée et charger ses traductions si nécessaire
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Sauvegarder dans localStorage
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
    }

    // Charger les traductions si nécessaire
    if (!translationsCache.has(language)) {
      fetchLanguageTranslations(language);
    }
  }, [language]);

  const translate = useCallback(
    (key: string, params?: TranslationParams) => {
      const dictionary = translations[language];
      const fallbackDictionary = translations.en;
      const template = dictionary?.[key] ?? fallbackDictionary[key] ?? key;
      return interpolate(template, params);
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: translate,
      availableLanguages: availableLangs,
      isLoading,
    }),
    [language, translate, availableLangs, isLoading],
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
