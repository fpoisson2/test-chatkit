export type Language = "en" | "fr";

export type TranslationValue = string;

export type TranslationDictionary = Record<string, TranslationValue>;

export type Translations = Record<Language, TranslationDictionary>;

export const AVAILABLE_LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

import { fr } from "./translations.fr";
import { en } from "./translations.en";

export const translations: Translations = {
  en,
  fr,
};
