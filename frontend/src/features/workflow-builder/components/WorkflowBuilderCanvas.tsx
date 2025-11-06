import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefCallback,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Connection,
  type EdgeChange,
  type EdgeMouseHandler,
  type NodeChange,
  type NodeDragHandler,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
  type PaneClickHandler,
  type ReactFlowInstance,
  type Viewport,
} from "reactflow";

import { Copy, PenSquare, Redo2, Trash2, Undo2 } from "lucide-react";

import styles from "../WorkflowBuilderPage.module.css";
import {
  defaultEdgeOptions,
  connectionLineStyle,
  NODE_COLORS,
} from "../utils";
import type {
  FlowEdge,
  FlowEdgeData,
  FlowNode,
  FlowNodeData,
} from "../types";
import { loadingStyle } from "../styles";

export interface MobileActionLabels {
  redo: string;
  undo: string;
  duplicate: string;
  delete: string;
  properties: string;
}

interface WorkflowBuilderCanvasProps {
  openSidebar: () => void;
  headerStyle: CSSProperties;
  headerNavigationButtonStyle: CSSProperties;
  renderHeaderControls: () => ReactNode;
  workspaceWrapperStyle: CSSProperties;
  workspaceContentStyle: CSSProperties;
  shouldShowWorkflowDescription: boolean;
  renderWorkflowDescription: () => ReactNode;
  shouldShowPublicationReminder: boolean;
  renderWorkflowPublicationReminder: () => ReactNode;
  reactFlowContainerRef: RefCallback<HTMLDivElement>;
  editorContainerStyle: CSSProperties;
  loading: boolean;
  loadError: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  handleNodesChange: (changes: NodeChange<FlowNodeData>[]) => void;
  handleEdgesChange: (changes: EdgeChange<FlowEdgeData>[]) => void;
  handleNodeDragStart: NodeDragHandler<FlowNode>;
  handleNodeDragStop: NodeDragHandler<FlowNode>;
  handleNodeClick: NodeMouseHandler<FlowNode>;
  handleEdgeClick: EdgeMouseHandler<FlowEdge>;
  handleClearSelection: PaneClickHandler;
  onConnect: (connection: Connection) => void;
  handleSelectionChange: OnSelectionChangeFunc<FlowNode, FlowEdge>;
  isMobileLayout: boolean;
  minViewportZoom: number;
  initialViewport: Viewport | undefined;
  reactFlowInstanceRef: MutableRefObject<ReactFlowInstance | null>;
  refreshViewportConstraints: (instance?: ReactFlowInstance | null) => number;
  pendingViewportRestoreRef: MutableRefObject<boolean>;
  restoreViewport: () => void;
  isHydratingRef: MutableRefObject<boolean>;
  viewportRef: MutableRefObject<Viewport | null>;
  hasUserViewportChangeRef: MutableRefObject<boolean>;
  viewportKeyRef: MutableRefObject<string | null>;
  viewportMemoryRef: MutableRefObject<Map<string, Viewport>>;
  persistViewportMemory: () => void;
  isBlockLibraryOpen: boolean;
  closeBlockLibrary: (options?: { focusToggle?: boolean }) => void;
  blockLibraryId: string;
  blockLibraryContent: ReactNode;
  redoHistory: () => void;
  undoHistory: () => void;
  handleDuplicateSelection: () => void;
  handleDeleteSelection: () => void;
  canRedoHistory: boolean;
  canUndoHistory: boolean;
  canDuplicateSelection: boolean;
  canDeleteSelection: boolean;
  hasSelectedElement: boolean;
  propertiesPanelToggleRef: MutableRefObject<HTMLButtonElement | null>;
  isPropertiesPanelOpen: boolean;
  handleClosePropertiesPanel: () => void;
  handleOpenPropertiesPanel: () => void;
  propertiesPanelId: string;
  blockLibraryToggleRef: MutableRefObject<HTMLButtonElement | null>;
  toggleBlockLibrary: () => void;
  floatingPanelStyle: CSSProperties | undefined;
  showPropertiesPanel: boolean;
  propertiesPanelElement: ReactNode;
  mobileActionLabels: MobileActionLabels;
}

const WorkflowBuilderCanvas = ({
  openSidebar,
  headerStyle,
  headerNavigationButtonStyle,
  renderHeaderControls,
  workspaceWrapperStyle,
  workspaceContentStyle,
  shouldShowWorkflowDescription,
  renderWorkflowDescription,
  shouldShowPublicationReminder,
  renderWorkflowPublicationReminder,
  reactFlowContainerRef,
  editorContainerStyle,
  loading,
  loadError,
  nodes,
  edges,
  handleNodesChange,
  handleEdgesChange,
  handleNodeDragStart,
  handleNodeDragStop,
  handleNodeClick,
  handleEdgeClick,
  handleClearSelection,
  onConnect,
  handleSelectionChange,
  isMobileLayout,
  minViewportZoom,
  initialViewport,
  reactFlowInstanceRef,
  refreshViewportConstraints,
  pendingViewportRestoreRef,
  restoreViewport,
  isHydratingRef,
  viewportRef,
  hasUserViewportChangeRef,
  viewportKeyRef,
  viewportMemoryRef,
  persistViewportMemory,
  isBlockLibraryOpen,
  closeBlockLibrary,
  blockLibraryId,
  blockLibraryContent,
  redoHistory,
  undoHistory,
  handleDuplicateSelection,
  handleDeleteSelection,
  canRedoHistory,
  canUndoHistory,
  canDuplicateSelection,
  canDeleteSelection,
  hasSelectedElement,
  propertiesPanelToggleRef,
  isPropertiesPanelOpen,
  handleClosePropertiesPanel,
  handleOpenPropertiesPanel,
  propertiesPanelId,
  blockLibraryToggleRef,
  toggleBlockLibrary,
  floatingPanelStyle,
  showPropertiesPanel,
  propertiesPanelElement,
  mobileActionLabels,
}: WorkflowBuilderCanvasProps) => {
  return (
    <>
      <header style={headerStyle}>
        <button
          type="button"
          onClick={openSidebar}
          aria-label="Ouvrir la navigation générale"
          style={headerNavigationButtonStyle}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {renderHeaderControls()}
      </header>

      <div style={workspaceWrapperStyle}>
        <div style={workspaceContentStyle}>
          {shouldShowWorkflowDescription ? renderWorkflowDescription() : null}
          {shouldShowPublicationReminder ? renderWorkflowPublicationReminder() : null}
          <div
            ref={reactFlowContainerRef}
            style={editorContainerStyle}
            className={styles.editorContainer}
            aria-label="Éditeur visuel du workflow"
          >
            <div className={styles.editorSplit}>
              <div className={styles.flowViewport}>
                {loading ? (
                  <div style={loadingStyle}>Chargement du workflow…</div>
                ) : loadError ? (
                  <div style={loadingStyle} role="alert">
                    {loadError}
                  </div>
                ) : (
                  <ReactFlow<FlowNode, FlowEdge>
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onNodeDragStart={handleNodeDragStart}
                    onNodeDragStop={handleNodeDragStop}
                    onNodeClick={handleNodeClick}
                    onEdgeClick={handleEdgeClick}
                    onPaneClick={handleClearSelection}
                    onConnect={onConnect}
                    defaultEdgeOptions={defaultEdgeOptions}
                    connectionLineStyle={connectionLineStyle}
                    selectionOnDrag={!isMobileLayout}
                    panOnDrag={isMobileLayout ? true : [1, 2]}
                    multiSelectionKeyCode={["Meta", "Control"]}
                    onSelectionChange={handleSelectionChange}
                    style={{
                      background: isMobileLayout
                        ? "transparent"
                        : "var(--color-surface-subtle)",
                      height: "100%",
                    }}
                    minZoom={minViewportZoom}
                    defaultViewport={initialViewport}
                    fitView={false}
                    onInit={(instance) => {
                      reactFlowInstanceRef.current = instance;
                      refreshViewportConstraints(instance);
                      if (pendingViewportRestoreRef.current) {
                        restoreViewport();
                      }
                    }}
                    onMoveEnd={(_, viewport) => {
                      if (isHydratingRef.current) {
                        return;
                      }
                      viewportRef.current = viewport;
                      hasUserViewportChangeRef.current = true;
                      const key = viewportKeyRef.current;
                      if (key) {
                        viewportMemoryRef.current.set(key, { ...viewport });
                        persistViewportMemory();
                      }
                    }}
                  >
                    <Background gap={18} size={1} />
                    {!isMobileLayout ? (
                      <MiniMap
                        nodeStrokeColor={(node) =>
                          NODE_COLORS[(node.data as FlowNodeData).kind]
                        }
                        nodeColor={(node) =>
                          NODE_COLORS[(node.data as FlowNodeData).kind]
                        }
                      />
                    ) : null}
                    <Controls />
                  </ReactFlow>
                )}
              </div>
            </div>
          </div>
        </div>
        {isMobileLayout ? (
          <>
            {isBlockLibraryOpen ? (
              <div
                className={styles.mobileOverlay}
                role="presentation"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    closeBlockLibrary({ focusToggle: true });
                  }
                }}
              >
                <aside
                  id={blockLibraryId}
                  aria-label="Bibliothèque de blocs"
                  className={`${styles.blockLibrary} ${styles.blockLibraryMobile}`}
                  role="dialog"
                  aria-modal="true"
                >
                  {blockLibraryContent}
                </aside>
              </div>
            ) : null}
            <div className={styles.mobileActionStack}>
              <button
                type="button"
                className={styles.mobileActionButton}
                onClick={() => {
                  redoHistory();
                }}
                disabled={!canRedoHistory}
              >
                <Redo2 aria-hidden="true" size={20} />
                <span className={styles.srOnly}>{mobileActionLabels.redo}</span>
              </button>
              <button
                type="button"
                className={styles.mobileActionButton}
                onClick={() => {
                  undoHistory();
                }}
                disabled={!canUndoHistory}
              >
                <Undo2 aria-hidden="true" size={20} />
                <span className={styles.srOnly}>{mobileActionLabels.undo}</span>
              </button>
              <button
                type="button"
                className={styles.mobileActionButton}
                onClick={() => {
                  handleDuplicateSelection();
                }}
                disabled={!canDuplicateSelection}
              >
                <Copy aria-hidden="true" size={20} />
                <span className={styles.srOnly}>{mobileActionLabels.duplicate}</span>
              </button>
              <button
                type="button"
                className={styles.mobileActionButton}
                onClick={() => {
                  handleDeleteSelection();
                }}
                disabled={!canDeleteSelection}
              >
                <Trash2 aria-hidden="true" size={20} />
                <span className={styles.srOnly}>{mobileActionLabels.delete}</span>
              </button>
              {hasSelectedElement ? (
                <button
                  type="button"
                  ref={propertiesPanelToggleRef}
                  className={styles.mobileActionButton}
                  onClick={
                    isPropertiesPanelOpen
                      ? handleClosePropertiesPanel
                      : handleOpenPropertiesPanel
                  }
                  aria-controls={propertiesPanelId}
                  aria-expanded={isPropertiesPanelOpen}
                >
                  <PenSquare aria-hidden="true" size={20} />
                  <span className={styles.srOnly}>{mobileActionLabels.properties}</span>
                </button>
              ) : null}
              <button
                type="button"
                ref={blockLibraryToggleRef}
                className={styles.mobileToggleButton}
                onClick={toggleBlockLibrary}
                aria-controls={blockLibraryId}
                aria-expanded={isBlockLibraryOpen}
              >
                <span aria-hidden="true">{isBlockLibraryOpen ? "×" : "+"}</span>
                <span className={styles.srOnly}>
                  {isBlockLibraryOpen
                    ? "Fermer la bibliothèque de blocs"
                    : "Ouvrir la bibliothèque de blocs"}
                </span>
              </button>
            </div>
          </>
        ) : (
          <aside
            id={blockLibraryId}
            aria-label="Bibliothèque de blocs"
            className={styles.blockLibrary}
            style={floatingPanelStyle}
          >
            {blockLibraryContent}
          </aside>
        )}
        {showPropertiesPanel ? (
          isMobileLayout ? (
            <div
              className={styles.propertiesPanelOverlay}
              role="presentation"
              onClick={handleClosePropertiesPanel}
            >
              {propertiesPanelElement}
            </div>
          ) : (
            propertiesPanelElement
          )
        ) : null}
      </div>
    </>
  );
};

export default WorkflowBuilderCanvas;
