import { z } from 'zod';
import { trimmedNonEmptyString, jsonSchema, requiredJsonSchema, positiveNumberSchema } from './common';

/**
 * Vector Store Form Schema
 */
export const vectorStoreFormSchema = z.object({
  slug: trimmedNonEmptyString,
  title: z.string().optional(),
  description: z.string().optional(),
  metadataInput: jsonSchema
});

export type VectorStoreFormData = z.infer<typeof vectorStoreFormSchema>;

/**
 * Vector Store Search Form Schema
 */
export const vectorStoreSearchFormSchema = z.object({
  query: trimmedNonEmptyString,
  topK: z.number().int().min(1).max(50).default(5),
  metadataFiltersInput: jsonSchema,
  denseWeight: z.number().min(0).default(0.5),
  sparseWeight: z.number().min(0).default(0.5)
});

export type VectorStoreSearchFormData = z.infer<typeof vectorStoreSearchFormSchema>;

/**
 * Vector Store Ingestion Form Schema
 */
export const vectorStoreIngestionFormSchema = z.object({
  docId: trimmedNonEmptyString,
  documentInput: requiredJsonSchema,
  metadataInput: jsonSchema,
  storeTitle: z.string().optional(),
  storeMetadataInput: jsonSchema
});

export type VectorStoreIngestionFormData = z.infer<typeof vectorStoreIngestionFormSchema>;
