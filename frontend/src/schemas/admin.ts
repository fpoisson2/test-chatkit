import { z } from 'zod';
import {
  trimmedNonEmptyString,
  optionalUrlSchema,
  languageCodeSchema,
  sipUriSchema,
  portSchema,
  jsonSchema,
  requiredJsonSchema,
  urlSchema,
  emailSchema
} from './common';

/**
 * Admin User Creation Form Schema
 */
export const adminCreateUserSchema = z.object({
  email: emailSchema,
  password: trimmedNonEmptyString,
  is_admin: z.boolean().default(false)
});

export type AdminCreateUserFormData = z.infer<typeof adminCreateUserSchema>;

/**
 * Admin Models Page Schema
 */
export const adminModelSchema = z.object({
  name: trimmedNonEmptyString,
  display_name: z.string().optional(),
  description: z.string().optional(),
  provider_id: z.string(),
  provider_slug: trimmedNonEmptyString,
  supports_reasoning: z.boolean().default(false)
});

export type AdminModelFormData = z.infer<typeof adminModelSchema>;

/**
 * Admin Model Providers Page Schema (Dynamic Array)
 */
export const modelProviderRowSchema = z.object({
  localId: z.string(),
  id: z.string().nullable(),
  provider: trimmedNonEmptyString.transform((val) => val.toLowerCase()),
  apiBase: optionalUrlSchema,
  apiKeyInput: z.string(),
  hasStoredKey: z.boolean(),
  apiKeyHint: z.string().nullable(),
  isDefault: z.boolean(),
  deleteStoredKey: z.boolean().default(false)
});

export const adminModelProvidersSchema = z.object({
  providers: z.array(modelProviderRowSchema)
    .min(1, { message: 'Au moins un fournisseur requis' })
    .refine(
      (providers) => providers.filter((p) => p.isDefault).length === 1,
      { message: 'Exactement un fournisseur par défaut requis' }
    )
});

export type ModelProviderFormData = z.infer<typeof adminModelProvidersSchema>;
export type ModelProviderRow = z.infer<typeof modelProviderRowSchema>;

/**
 * Single Model Provider Schema - for create/edit modal
 */
export const singleModelProviderSchema = z.object({
  provider: trimmedNonEmptyString.transform((val) => val.toLowerCase()),
  apiBase: optionalUrlSchema,
  apiKey: z.string().optional(),
  isDefault: z.boolean().default(false),
  deleteStoredKey: z.boolean().default(false)
});

export type SingleModelProviderFormData = z.infer<typeof singleModelProviderSchema>;

/**
 * Admin App Settings Page Schema
 */
export const adminAppSettingsSchema = z.object({
  prompt: trimmedNonEmptyString,
  threadTitleModel: trimmedNonEmptyString,
  selectedModelOption: z.string()
});

export type AdminAppSettingsFormData = z.infer<typeof adminAppSettingsSchema>;

/**
 * Admin Languages Page Schema
 */
export const adminLanguageSchema = z.object({
  code: languageCodeSchema,
  name: trimmedNonEmptyString,
  model: z.string().optional(),
  provider_value: z.string(),
  custom_prompt: z.string().optional(),
  save_to_db: z.boolean().default(true)
});

export type AdminLanguageFormData = z.infer<typeof adminLanguageSchema>;

/**
 * Admin MCP Servers Page Schema
 */
export const adminMcpServerSchema = z.object({
  label: trimmedNonEmptyString,
  serverUrl: urlSchema,
  authorization: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  oauthClientId: z.string().optional(),
  oauthClientSecret: z.string().optional(),
  oauthScope: z.string().optional(),
  oauthAuthorizationEndpoint: optionalUrlSchema,
  oauthTokenEndpoint: optionalUrlSchema,
  oauthRedirectUri: optionalUrlSchema,
  oauthMetadata: jsonSchema,
  isActive: z.boolean().default(true)
});

export type AdminMcpServerFormData = z.infer<typeof adminMcpServerSchema>;

/**
 * Admin Telephony Page Schema (SIP Accounts)
 */
export const adminTelephonySchema = z.object({
  label: trimmedNonEmptyString,
  trunk_uri: sipUriSchema,
  username: z.string().optional(),
  password: z.string().optional(),
  contact_host: z.string().optional(),
  contact_port: portSchema,
  contact_transport: z.enum(['udp', 'tcp', 'tls']).default('udp'),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true)
});

export type AdminTelephonyFormData = z.infer<typeof adminTelephonySchema>;

/**
 * Admin LTI Page Schemas
 */
export const adminLtiToolSettingsSchema = z.object({
  clientId: trimmedNonEmptyString,
  keySetUrl: urlSchema,
  audience: z.string().optional(),
  keyId: z.string().optional(),
  privateKey: z.string().optional()
});

export type AdminLtiToolSettingsFormData = z.infer<typeof adminLtiToolSettingsSchema>;

export const adminLtiRegistrationSchema = z.object({
  issuer: urlSchema,
  clientId: trimmedNonEmptyString,
  keySetUrl: urlSchema,
  authorizationEndpoint: urlSchema,
  tokenEndpoint: urlSchema,
  deepLinkReturnUrl: optionalUrlSchema,
  audience: z.string().optional()
});

export type AdminLtiRegistrationFormData = z.infer<typeof adminLtiRegistrationSchema>;
