/**
 * Phase 3 Hooks - Custom Hook Exports
 *
 * This file exports all the custom hooks created in Phase 3 of the
 * workflow builder refactoring project.
 *
 * @phase Phase 3 - Creation of Custom Hooks
 */

// Hook 3.1 - Graph Management
export { useWorkflowGraph } from "./useWorkflowGraph";

// Hook 3.2 - Version Management
export { useVersionManagement } from "./useVersionManagement";

// Hook 3.3 - Workflow Operations
export { useWorkflowOperations } from "./useWorkflowOperations";

// Hook 3.4 - Ref Synchronization
export { useRefSynchronization, useRefSynchronizationWithEffect, useSyncedRef } from "./useRefSynchronization";

// Hook 3.5 - API Retry Logic
export { useApiRetry } from "./useApiRetry";

// Hook 3.6 - Workflow Validation
export { useWorkflowValidation } from "./useWorkflowValidation";

// Hook 3.7 - Mobile Double Tap
export { useMobileDoubleTap, useMobileDoubleTapWithElement } from "./useMobileDoubleTap";
