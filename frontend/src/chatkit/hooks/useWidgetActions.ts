import { useCallback, useRef, MutableRefObject } from 'react';
import type { ChatKitControl, ChatKitOptions, ActionConfig, Action } from '../types';
import type { WidgetContext } from '../widgets/renderers/types';

export interface UseWidgetActionsOptions {
  control: ChatKitControl;
  widgets?: ChatKitOptions['widgets'];
}

export interface UseWidgetActionsReturn {
  createWidgetContext: (itemId: string) => WidgetContext;
  formDataRef: MutableRefObject<FormData | null>;
}

/**
 * Hook to create widget context objects with action handlers.
 * Handles form data collection and action dispatch to the backend.
 */
export function useWidgetActions({
  control,
  widgets,
}: UseWidgetActionsOptions): UseWidgetActionsReturn {
  const formDataRef = useRef<FormData | null>(null);

  const createWidgetContext = useCallback(
    (itemId: string): WidgetContext => ({
      onAction: (actionConfig: ActionConfig) => {
        // Convert ActionConfig to Action format expected by customAction
        // ActionConfig structure: { type, payload, handler?, loadingBehavior? }
        // handler and loadingBehavior are ActionConfig properties, NOT part of payload
        const { type, payload, handler, loadingBehavior, ...rest } = actionConfig;

        // Collect form data if available
        const formData = formDataRef.current
          ? Object.fromEntries(formDataRef.current.entries())
          : {};

        // Build the payload combining all data sources
        // The payload is stored as-is in raw_payload, so data should be at root level
        // for workflow access via input.action.raw_payload.fieldName
        const actionPayload = {
          ...(payload || {}),
          ...formData,
          ...rest, // Include any extra properties that aren't ActionConfig metadata
        };

        const action: Action = {
          type,
          // Use 'data' for frontend Action type, will be converted to 'payload' by API
          data: actionPayload,
        };

        // Clear form data after use
        formDataRef.current = null;
        // Send the action to the backend
        control.customAction(itemId, action);
      },
      onFormData: (data: FormData) => {
        // Store form data to be included in the next action
        formDataRef.current = data;
      },
      voiceSession: widgets?.voiceSession,
      outboundCall: widgets?.outboundCall,
    }),
    [control, widgets?.voiceSession, widgets?.outboundCall]
  );

  return {
    createWidgetContext,
    formDataRef,
  };
}
