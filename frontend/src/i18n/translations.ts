export type Language = string;

export type TranslationValue = string;

export type TranslationDictionary = Record<string, TranslationValue>;

export type Translations = Record<string, TranslationDictionary>;

// Langues de base chargées statiquement
export const BASE_LANGUAGES = ["en", "fr"] as const;

// AVAILABLE_LANGUAGES sera chargé dynamiquement au démarrage
export let AVAILABLE_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

import { fr } from "./translations.fr";
import { en } from "./translations.en";

// Traductions de base (chargées statiquement)
export const translations: Translations = {
  en,
  fr,
};

// Fonction pour mettre à jour les langues disponibles
export const updateAvailableLanguages = (languages: { code: string; label: string }[]) => {
  AVAILABLE_LANGUAGES = languages;
};

// Fonction pour ajouter des traductions dynamiquement
export const addTranslations = (code: string, dictionary: TranslationDictionary) => {
  translations[code] = dictionary;
};
