import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefCallback,
  useMemo,
  useRef,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
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
} from "@xyflow/react";

import { Copy, PenSquare, Redo2, Trash2, Undo2 } from "lucide-react";

import styles from "../WorkflowBuilderPage.module.css";
import {
  defaultEdgeOptions,
  connectionLineStyle,
} from "../utils";
import type {
  FlowEdge,
  FlowNode,
} from "../types";
import {
  loadingStyle,
  getHeaderContainerStyle,
  getHeaderNavigationButtonStyle,
} from "../styles";
import {
  useGraphContext,
  useViewportContext,
  useUIContext,
  useSelectionContext,
  useWorkflowContext,
} from "../contexts";
import { DESKTOP_WORKSPACE_HORIZONTAL_PADDING } from "../WorkflowBuilderUtils";
import { useI18n } from "../../../i18n";
import { nodeTypes } from "./nodes/nodeTypes";
import { edgeTypes } from "./edges/edgeTypes";

export interface MobileActionLabels {
  redo: string;
  undo: string;
  duplicate: string;
  delete: string;
  properties: string;
}

// Phase 5: Canvas Refactor - Reduced from 21 props to 10 props (-52%)
// Migrated to contexts:
// Phase 4.5:
// - isMobileLayout → UIContext
// - workflowBusy → Derived from WorkflowContext.loading + UIContext.isExporting + UIContext.isImporting
// - mobileActionLabels → Calculated with useI18n
// - shouldShowWorkflowDescription → Derived from WorkflowContext + UIContext.isMobileLayout
// - shouldShowPublicationReminder → Derived from WorkflowContext + UIContext.isMobileLayout
// Phase 5 (this refactor):
// - handleNodesChange → GraphContext.onNodesChange
// - handleEdgesChange → GraphContext.onEdgesChange
// - handleNodeClick → SelectionContext.handleNodeClick
// - handleEdgeClick → SelectionContext.handleEdgeClick
// - handleClearSelection → SelectionContext.handleClearSelection
// - handleSelectionChange → SelectionContext.onSelectionChange
// - redoHistory, undoHistory → GraphContext
// - handleDuplicateSelection, handleDeleteSelection → GraphContext
// - canRedoHistory, canUndoHistory → GraphContext
interface WorkflowBuilderCanvasProps {
  // Sidebar navigation
  openSidebar: () => void;
  isSidebarOpen: boolean;

  // Render props (delegated rendering)
  renderHeaderControls: () => ReactNode;
  renderWorkflowDescription: () => ReactNode;
  renderWorkflowPublicationReminder: () => ReactNode;
  blockLibraryContent: ReactNode;
  propertiesPanelElement: ReactNode;

  // Refs (callbacks)
  reactFlowContainerRef: RefCallback<HTMLDivElement>;

  // Drag handlers (complex external logic - remains as prop due to complexity)
  handleNodeDragStart: NodeDragHandler<FlowNode>;
  handleNodeDragStop: NodeDragHandler<FlowNode>;
}

const WorkflowBuilderCanvas = ({
  // Phase 5: Reduced to 10 props
  openSidebar,
  isSidebarOpen,
  renderHeaderControls,
  renderWorkflowDescription,
  renderWorkflowPublicationReminder,
  blockLibraryContent,
  propertiesPanelElement,
  reactFlowContainerRef,
  handleNodeDragStart,
  handleNodeDragStop,
}: WorkflowBuilderCanvasProps) => {
  const { t } = useI18n();

  // GraphContext - Graph state, handlers, and operations (Phase 5: expanded)
  const {
    nodes,
    edges,
    onConnect,
    onNodesChange,
    onEdgesChange,
    undoHistory,
    redoHistory,
    canUndoHistory,
    canRedoHistory,
    handleDuplicateSelection,
    handleDeleteSelection,
    canDuplicateSelection: canDuplicateFromContext,
    canDeleteSelection: canDeleteFromContext,
  } = useGraphContext();

  // ViewportContext - Viewport state and persistence (12 values)
  const {
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
  } = useViewportContext();

  // UIContext - UI panel state (8 values) - Phase 4.5: Added isMobileLayout, isExporting, isImporting
  const {
    isBlockLibraryOpen,
    closeBlockLibrary,
    isPropertiesPanelOpen,
    closePropertiesPanel,
    openPropertiesPanel,
    toggleBlockLibrary,
    isMobileLayout,
    isExporting,
    isImporting,
  } = useUIContext();

  // Phase 4.5: Local constants for accessibility IDs (no longer passed as props)
  const blockLibraryId = "workflow-builder-block-library";
  const propertiesPanelId = "workflow-builder-properties-panel";
  const blockLibraryToggleRef = useRef<HTMLButtonElement | null>(null);
  const propertiesPanelToggleRef = useRef<HTMLButtonElement | null>(null);

  // SelectionContext - Selection state and handlers (Phase 5: expanded)
  const {
    selectedNodeId,
    selectedEdgeId,
    handleNodeClick,
    handleEdgeClick,
    handleClearSelection,
    onSelectionChange,
  } = useSelectionContext();

  // WorkflowContext - Workflow loading state (5 values) - Phase 4.5: Added workflows, selectedWorkflowId
  const {
    loading,
    loadError,
    workflows,
    selectedWorkflowId,
  } = useWorkflowContext();

  // Phase 4.5: Derived values from contexts
  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) || null,
    [workflows, selectedWorkflowId]
  );

  const workflowBusy = loading || isImporting || isExporting;

  const shouldShowWorkflowDescription = !isMobileLayout && Boolean(selectedWorkflow?.description);
  const shouldShowPublicationReminder =
    !isMobileLayout && Boolean(selectedWorkflow) && !selectedWorkflow?.active_version_id;

  const mobileActionLabels = useMemo<MobileActionLabels>(
    () => ({
      redo: t("workflowBuilder.mobileActions.redo"),
      undo: t("workflowBuilder.mobileActions.undo"),
      duplicate: t("workflowBuilder.mobileActions.duplicate"),
      delete: t("workflowBuilder.mobileActions.delete"),
      properties: t("workflowBuilder.mobileActions.properties"),
    }),
    [t]
  );

  // Computed selection state
  const hasSelectedElement = Boolean(selectedNodeId || selectedEdgeId);

  // Phase 5: Operation availability from context (fallback to local calculation)
  const canDeleteSelection = canDeleteFromContext ?? (hasSelectedElement && !workflowBusy);
  const canDuplicateSelection = canDuplicateFromContext ?? (hasSelectedElement && !workflowBusy);

  // Style calculations (moved from WorkflowBuilderPage)
  const headerOverlayOffset = useMemo(
    () => (isMobileLayout ? "4rem" : "4.25rem"),
    [isMobileLayout],
  );

  const headerStyle = useMemo(() => {
    const baseStyle = getHeaderContainerStyle(isMobileLayout);
    return { ...baseStyle, position: "absolute" as const, top: 0, left: 0, right: 0 };
  }, [isMobileLayout]);

  const headerNavigationButtonStyle = useMemo(
    () => getHeaderNavigationButtonStyle(isMobileLayout),
    [isMobileLayout],
  );

  const workspaceWrapperStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return { position: "absolute" as const, inset: 0, overflow: "hidden" };
    }
    return { position: "relative" as const, flex: 1, overflow: "hidden", minHeight: 0 };
  }, [isMobileLayout]);

  const workspaceContentStyle = useMemo<CSSProperties>(() => {
    if (isMobileLayout) {
      return {
        position: "absolute" as const,
        inset: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "0",
      };
    }

    const hasWorkflowMeta = shouldShowWorkflowDescription || shouldShowPublicationReminder;

    return {
      position: "absolute" as const,
      inset: 0,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      gap: hasWorkflowMeta ? "1rem" : "0",
      paddingTop: `calc(${headerOverlayOffset}${
        hasWorkflowMeta ? ` + ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING}` : ""
      })`,
      paddingBottom: 0,
      paddingLeft: DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
      paddingRight: DESKTOP_WORKSPACE_HORIZONTAL_PADDING,
    };
  }, [
    headerOverlayOffset,
    isMobileLayout,
    shouldShowPublicationReminder,
    shouldShowWorkflowDescription,
  ]);

  const editorContainerStyle = useMemo<CSSProperties>(() => {
    const baseStyle: CSSProperties = {
      flex: 1,
      minHeight: 0,
      borderRadius: isMobileLayout ? 0 : "1.25rem",
      border: isMobileLayout ? "none" : "1px solid var(--surface-border)",
      background: "var(--surface-strong)",
      overflow: "hidden",
      boxShadow: isMobileLayout ? "none" : "var(--shadow-card)",
    };

    if (!isMobileLayout) {
      baseStyle.marginLeft = `calc(-1 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`;
      baseStyle.marginRight = `calc(-1 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`;
    }

    if (!isMobileLayout && !(shouldShowWorkflowDescription || shouldShowPublicationReminder)) {
      baseStyle.marginTop = `calc(-1 * ${headerOverlayOffset})`;
    }

    return baseStyle;
  }, [
    headerOverlayOffset,
    isMobileLayout,
    shouldShowPublicationReminder,
    shouldShowWorkflowDescription,
  ]);

  const floatingPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMobileLayout) {
      return undefined;
    }

    return {
      top: `calc(${headerOverlayOffset} + ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING})`,
      maxHeight: `calc(100% - (${headerOverlayOffset} + 2 * ${DESKTOP_WORKSPACE_HORIZONTAL_PADDING}))`,
    };
  }, [headerOverlayOffset, isMobileLayout]);

  const showPropertiesPanel = isPropertiesPanelOpen && hasSelectedElement;

  return (
    <>
      <header style={headerStyle}>
        {!isSidebarOpen && (
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
        )}
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
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeDragStart={handleNodeDragStart}
                    onNodeDragStop={handleNodeDragStop}
                    onNodeClick={handleNodeClick}
                    onEdgeClick={handleEdgeClick}
                    onPaneClick={handleClearSelection}
                    onConnect={onConnect}
                    defaultEdgeOptions={defaultEdgeOptions}
                    connectionLineStyle={connectionLineStyle}
                    nodesDraggable={!isMobileLayout}
                    selectionOnDrag={!isMobileLayout}
                    panOnDrag={isMobileLayout ? true : [1, 2]}
                    multiSelectionKeyCode={["Meta", "Control"]}
                    deleteKeyCode={null}
                    panActivationKeyCode={null}
                    disableKeyboardA11y={true}
                    {...(!isMobileLayout && onSelectionChange && { onSelectionChange })}
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
                  redoHistory?.();
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
                  undoHistory?.();
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
                  handleDuplicateSelection?.();
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
                  handleDeleteSelection?.();
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
                      ? closePropertiesPanel
                      : openPropertiesPanel
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
              onClick={closePropertiesPanel}
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
