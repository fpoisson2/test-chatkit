import {
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefCallback,
  useMemo,
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

export interface MobileActionLabels {
  redo: string;
  undo: string;
  duplicate: string;
  delete: string;
  properties: string;
}

interface WorkflowBuilderCanvasProps {
  // Sidebar navigation
  openSidebar: () => void;

  // Render props (delegated rendering)
  renderHeaderControls: () => ReactNode;
  renderWorkflowDescription: () => ReactNode;
  renderWorkflowPublicationReminder: () => ReactNode;
  blockLibraryContent: ReactNode;
  propertiesPanelElement: ReactNode;

  // Refs (callbacks)
  reactFlowContainerRef: RefCallback<HTMLDivElement>;

  // Drag handlers (complex external logic)
  handleNodeDragStart: NodeDragHandler<FlowNode>;
  handleNodeDragStop: NodeDragHandler<FlowNode>;

  // Configuration labels
  mobileActionLabels: MobileActionLabels;

  // Render conditions (calculated in parent)
  shouldShowWorkflowDescription: boolean;
  shouldShowPublicationReminder: boolean;

  // Layout flag
  isMobileLayout: boolean;
}

const WorkflowBuilderCanvas = ({
  // Props from parent (14 legitimate props)
  openSidebar,
  renderHeaderControls,
  renderWorkflowDescription,
  renderWorkflowPublicationReminder,
  blockLibraryContent,
  propertiesPanelElement,
  reactFlowContainerRef,
  handleNodeDragStart,
  handleNodeDragStop,
  mobileActionLabels,
  shouldShowWorkflowDescription,
  shouldShowPublicationReminder,
  isMobileLayout,
}: WorkflowBuilderCanvasProps) => {
  // GraphContext - Graph state and operations (13 values)
  const {
    nodes,
    edges,
    handleNodesChange,
    handleEdgesChange,
    onConnect,
    redoHistory,
    undoHistory,
    handleDuplicateSelection,
    handleDeleteSelection,
    canRedoHistory,
    canUndoHistory,
    canDuplicateSelection,
    canDeleteSelection,
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

  // UIContext - UI panel state (11 values)
  const {
    isBlockLibraryOpen,
    closeBlockLibrary,
    blockLibraryId,
    isPropertiesPanelOpen,
    closePropertiesPanel,
    openPropertiesPanel,
    propertiesPanelId,
    toggleBlockLibrary,
    propertiesPanelToggleRef,
    blockLibraryToggleRef,
  } = useUIContext();

  // SelectionContext - Selection handlers (5 values)
  const {
    handleNodeClick,
    handleEdgeClick,
    handleClearSelection,
    handleSelectionChange,
    hasSelectedElement,
  } = useSelectionContext();

  // WorkflowContext - Workflow loading state (2 values)
  const {
    loading,
    loadError,
  } = useWorkflowContext();

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
