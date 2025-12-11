import { ReactFlowProvider } from "@xyflow/react";
import {
  WorkflowProvider,
  SelectionProvider,
  GraphProvider,
  SaveProvider,
  ModalProvider,
  ViewportProvider,
  UIProvider,
} from "./contexts";
import WorkflowBuilderPage from "./WorkflowBuilderPage";

/**
 * WorkflowBuilderContainer provides all context providers for the workflow builder.
 * This separates concerns and makes state management more maintainable.
 */
export default function WorkflowBuilderContainer() {
  return (
    <ReactFlowProvider>
      <WorkflowProvider>
        <SelectionProvider>
          <GraphProvider>
            <SaveProvider>
              <ModalProvider>
                <ViewportProvider>
                  <UIProvider>
                    <WorkflowBuilderPage />
                  </UIProvider>
                </ViewportProvider>
              </ModalProvider>
            </SaveProvider>
          </GraphProvider>
        </SelectionProvider>
      </WorkflowProvider>
    </ReactFlowProvider>
  );
}
