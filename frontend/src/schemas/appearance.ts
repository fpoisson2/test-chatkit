import { z } from 'zod';
import { hexColorSchema, numberInRange } from './common';

/**
 * Appearance Form Schema
 */
export const appearanceFormSchema = z.object({
  colorScheme: z.enum(['system', 'light', 'dark']).default('system'),
  accentColor: hexColorSchema,
  useCustomSurfaceColors: z.boolean().default(false),
  surfaceHue: numberInRange(0, 360, 'Teinte doit être entre 0 et 360').default(0),
  surfaceTint: numberInRange(0, 100, 'Tint doit être entre 0 et 100').default(50),
  surfaceShade: numberInRange(0, 100, 'Shade doit être entre 0 et 100').default(50),
  headingFont: z.string().optional(),
  bodyFont: z.string().optional(),
  startGreeting: z.string().optional(),
  startPrompt: z.string().optional(),
  inputPlaceholder: z.string().optional(),
  disclaimer: z.string().optional()
});

export type AppearanceFormData = z.infer<typeof appearanceFormSchema>;
