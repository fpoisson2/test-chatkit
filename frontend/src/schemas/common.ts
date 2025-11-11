import { z } from 'zod';

/**
 * Common Zod schemas and validators for form validation
 */

// URL validation
export const urlSchema = z.string().url({ message: 'URL invalide' }).or(z.literal(''));

// Optional URL (empty string is valid)
export const optionalUrlSchema = z.string().refine(
  (val) => val === '' || z.string().url().safeParse(val).success,
  { message: 'URL invalide' }
);

// Email validation
export const emailSchema = z.string().email({ message: 'Email invalide' });

// JSON validation
export const jsonSchema = z.string().refine(
  (val) => {
    if (val.trim() === '') return true;
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'JSON invalide' }
);

// Required JSON (must be valid and non-empty)
export const requiredJsonSchema = z.string().refine(
  (val) => {
    if (val.trim() === '') return false;
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'JSON valide requis' }
);

// Port number validation (1-65535)
export const portSchema = z.string().refine(
  (val) => {
    if (val === '') return true;
    const num = parseInt(val, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  },
  { message: 'Port doit être entre 1 et 65535' }
);

// SIP URI validation
export const sipUriSchema = z.string().regex(
  /^sips?:.+@.+$/,
  { message: 'URI SIP invalide (format: sip:user@domain ou sips:user@domain)' }
);

// Language code validation (2-letter code)
export const languageCodeSchema = z.string().regex(
  /^[a-z]{2}$/,
  { message: 'Code langue doit être 2 lettres minuscules (ex: fr, en)' }
);

// Hex color validation
export const hexColorSchema = z.string().regex(
  /^#[0-9A-Fa-f]{6}$/,
  { message: 'Couleur hexadécimale invalide (format: #RRGGBB)' }
);

// Number range validation helper
export const numberInRange = (min: number, max: number, message?: string) =>
  z.number().min(min).max(max, message || `Doit être entre ${min} et ${max}`);

// Positive number
export const positiveNumberSchema = z.number().positive({ message: 'Doit être positif' });

// Non-empty string
export const nonEmptyString = z.string().min(1, { message: 'Champ requis' });

// Trimmed non-empty string
export const trimmedNonEmptyString = z.string().trim().min(1, { message: 'Champ requis' });
