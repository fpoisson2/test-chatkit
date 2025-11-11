import { z } from 'zod';
import { emailSchema, trimmedNonEmptyString } from './common';

/**
 * Login Form Schema
 */
export const loginFormSchema = z.object({
  email: emailSchema,
  password: trimmedNonEmptyString
});

export type LoginFormData = z.infer<typeof loginFormSchema>;
