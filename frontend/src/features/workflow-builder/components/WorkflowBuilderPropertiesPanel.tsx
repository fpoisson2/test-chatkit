import { useRef, useMemo, type CSSProperties } from "react";
import { useUIContext } from "../contexts";
import NodeInspector from "./NodeInspector";
import EdgeInspector from "./EdgeInspector";
import styles from "../WorkflowBuilderPage.module.css";

import type {
  FlowNode,
  FlowEdge,
  Workflow,
  HostedWorkflow,
  VectorStore,
  Widget,
} from "../WorkflowBuilderUtils";
import type { WorkflowNodeHandlers } from "../hooks/useWorkflowNodeHandlers";

/**
 * Props for WorkflowBuilderPropertiesPanel
 * These are mostly pass-through props for NodeInspector and EdgeInspector
 */
interface WorkflowBuilderPropertiesPanelProps {
  // Layout
  isMobileLayout: boolean;
  floatingPanelStyle?: CSSProperties;
  propertiesPanelId: string;
  propertiesPanelTitleId: string;

  // Selected elements
  selectedNode: FlowNode | null;
  selectedEdge: FlowEdge | null;
  selectedElementLabel: string;
  hasSelectedElement: boolean;

  // NodeInspector props
  nodeHandlers: WorkflowNodeHandlers;
  workflows: Workflow[];
  currentWorkflowId: string | number | null;
  hostedWorkflows: HostedWorkflow[];
  hostedWorkflowsLoading: boolean;
  hostedWorkflowsError: string | null;
  availableModels: string[];
  availableModelsLoading: boolean;
  availableModelsError: string | null;
  isReasoningModel: (model: string) => boolean;
  vectorStores: VectorStore[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  widgets: Widget[];
  widgetsLoading: boolean;
  widgetsError: string | null;

  // Handlers
  onRemoveNode: (id: string) => void;
  onRemoveEdge: (id: string) => void;
  onConditionChange: (edgeId: string, value: string) => void;
  onLabelChange: (edgeId: string, value: string) => void;
  onClosePropertiesPanel: () => void;
}

/**
 * WorkflowBuilderPropertiesPanel displays properties for selected nodes/edges
 * Uses UIContext for panel state and accepts props for data/handlers
 */
export default function WorkflowBuilderPropertiesPanel({
  isMobileLayout,
  floatingPanelStyle,
  propertiesPanelId,
  propertiesPanelTitleId,
  selectedNode,
  selectedEdge,
  selectedElementLabel,
  hasSelectedElement,
  nodeHandlers,
  workflows,
  currentWorkflowId,
  hostedWorkflows,
  hostedWorkflowsLoading,
  hostedWorkflowsError,
  availableModels,
  availableModelsLoading,
  availableModelsError,
  isReasoningModel,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  widgets,
  widgetsLoading,
  widgetsError,
  onRemoveNode,
  onRemoveEdge,
  onConditionChange,
  onLabelChange,
  onClosePropertiesPanel,
}: WorkflowBuilderPropertiesPanelProps) {
  const { isPropertiesPanelOpen } = useUIContext();
  const propertiesPanelCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  const showPropertiesPanel = hasSelectedElement && (!isMobileLayout || isPropertiesPanelOpen);

  if (!showPropertiesPanel) {
    return null;
  }

  return (
    <aside
      id={propertiesPanelId}
      aria-label="Propriétés du bloc sélectionné"
      aria-labelledby={propertiesPanelTitleId}
      className={isMobileLayout ? styles.propertiesPanelMobile : styles.propertiesPanel}
      role={isMobileLayout ? "dialog" : undefined}
      aria-modal={isMobileLayout ? true : undefined}
      onClick={isMobileLayout ? (event) => event.stopPropagation() : undefined}
      style={!isMobileLayout ? floatingPanelStyle : undefined}
    >
      <header className={styles.propertiesPanelHeader}>
        <div className={styles.propertiesPanelHeaderMeta}>
          <p className={styles.propertiesPanelOverline}>Propriétés du bloc</p>
          <h2 id={propertiesPanelTitleId} className={styles.propertiesPanelTitle}>
            {selectedElementLabel || "Bloc"}
          </h2>
        </div>
        <button
          type="button"
          ref={propertiesPanelCloseButtonRef}
          onClick={onClosePropertiesPanel}
          aria-label="Fermer le panneau de propriétés"
          className={styles.propertiesPanelCloseButton}
        >
          ×
        </button>
      </header>
      <div className={styles.propertiesPanelBody}>
        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            nodeHandlers={nodeHandlers}
            workflows={workflows}
            currentWorkflowId={currentWorkflowId}
            hostedWorkflows={hostedWorkflows}
            hostedWorkflowsLoading={hostedWorkflowsLoading}
            hostedWorkflowsError={hostedWorkflowsError}
            availableModels={availableModels}
            availableModelsLoading={availableModelsLoading}
            availableModelsError={availableModelsError}
            isReasoningModel={isReasoningModel}
            vectorStores={vectorStores}
            vectorStoresLoading={vectorStoresLoading}
            vectorStoresError={vectorStoresError}
            widgets={widgets}
            widgetsLoading={widgetsLoading}
            widgetsError={widgetsError}
            onRemove={onRemoveNode}
          />
        ) : selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            onConditionChange={onConditionChange}
            onLabelChange={onLabelChange}
            onRemove={onRemoveEdge}
          />
        ) : null}
      </div>
    </aside>
  );
}
