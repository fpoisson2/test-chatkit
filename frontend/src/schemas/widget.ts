import { z } from 'zod';
import { trimmedNonEmptyString, requiredJsonSchema } from './common';

/**
 * Widget Template Form Schema
 */
export const widgetTemplateFormSchema = z.object({
  slug: trimmedNonEmptyString,
  title: z.string().optional(),
  description: z.string().optional(),
  definitionInput: requiredJsonSchema
});

export type WidgetTemplateFormData = z.infer<typeof widgetTemplateFormSchema>;
