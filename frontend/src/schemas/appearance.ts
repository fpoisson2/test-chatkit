import { z } from 'zod';
import { hexColorSchema, numberInRange } from './common';

const DEFAULT_COLOR = "#2563eb";
const DEFAULT_FONT = '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

/**
 * Transform to ensure color value starts with #
 */
const colorWithHashSchema = z.string().transform((val) => {
  const trimmed = val.trim();
  if (!trimmed) return DEFAULT_COLOR;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}).pipe(hexColorSchema);

/**
 * Appearance Form Schema
 */
export const appearanceFormSchema = z.object({
  colorScheme: z.enum(['system', 'light', 'dark']).default('system'),
  radiusStyle: z.enum(['pill', 'round', 'soft', 'sharp']).default('soft'),
  accentColor: colorWithHashSchema.default(DEFAULT_COLOR),
  useCustomSurfaceColors: z.boolean().default(false),
  surfaceHue: numberInRange(0, 360, 'Teinte doit être entre 0 et 360').default(222),
  surfaceTint: numberInRange(0, 100, 'Tint doit être entre 0 et 100').default(92),
  surfaceShade: numberInRange(0, 100, 'Shade doit être entre 0 et 100').default(16),
  headingFont: z.string().default(DEFAULT_FONT),
  bodyFont: z.string().default(DEFAULT_FONT),
  startGreeting: z.string().default(''),
  startPrompt: z.string().default(''),
  inputPlaceholder: z.string().default(''),
  disclaimer: z.string().default('')
});

export type AppearanceFormData = z.infer<typeof appearanceFormSchema>;
