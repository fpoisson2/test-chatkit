import { z } from 'zod';
import { trimmedNonEmptyString } from './common';

/**
 * Create Workflow Modal Schema
 */
export const createWorkflowSchema = z.object({
  kind: z.enum(['local', 'hosted']).default('local'),
  name: trimmedNonEmptyString,
  remoteId: z.string().optional()
}).refine(
  (data) => {
    // If kind is 'hosted', remoteId is required
    if (data.kind === 'hosted') {
      return !!data.remoteId && data.remoteId.trim().length > 0;
    }
    return true;
  },
  {
    message: 'Remote ID requis pour les workflows hébergés',
    path: ['remoteId']
  }
);

export type CreateWorkflowFormData = z.infer<typeof createWorkflowSchema>;
