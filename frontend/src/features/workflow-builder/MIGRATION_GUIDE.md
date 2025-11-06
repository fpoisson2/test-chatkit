# WorkflowBuilderPage.tsx Migration Guide

This document provides a step-by-step guide to migrate the monolithic `WorkflowBuilderPage.tsx` to use the extracted modules.

## Current Status

- **Current size**: 8,489 lines
- **Target size**: ~3,000-4,000 lines (50-60% reduction)
- **Strategy**: Incremental migration with testing after each step

## Migration Steps

### Step 1: Add Imports ✅ (To Do First)

Add imports for extracted modules at the top of the file:

```typescript
// Custom Hooks
import { useWorkflowState } from "./hooks/useWorkflowState";
import { useFlowState } from "./hooks/useFlowState";
import { useVersionState } from "./hooks/useVersionState";
import { useSaveState } from "./hooks/useSaveState";
import { useModalState } from "./hooks/useModalState";
import { useResourcesState } from "./hooks/useResourcesState";
import { useViewportState } from "./hooks/useViewportState";
import { useMediaQuery } from "./hooks/useMediaQuery";

// Services
import { WorkflowService } from "./services/workflowService";
import { VersionService } from "./services/versionService";
import { ImportExportService } from "./services/importExportService";

// UI Components
import { SaveToast } from "./components/modals/SaveToast";
import { DeployModal } from "./components/modals/DeployModal";
import { PropertiesPanel } from "./components/panels/PropertiesPanel";
import { BlockLibraryPanel } from "./components/panels/BlockLibraryPanel";
import { WorkflowHeader } from "./components/header/WorkflowHeader";
import { WorkflowSidebar } from "./components/sidebar/WorkflowSidebar";

// Constants
import {
  DESKTOP_MIN_VIEWPORT_ZOOM,
  MOBILE_MIN_VIEWPORT_ZOOM,
  AUTO_SAVE_DELAY_MS,
  // ... other constants
} from "./utils-internal/constants";
```

### Step 2: Replace useState with Custom Hooks

#### 2.1 Replace Workflow State (Lines ~461-497)

**Before:**
```typescript
const [workflows, setWorkflows] = useState<WorkflowSummary[]>(() => initialCache?.workflows ?? []);
const [hostedWorkflows, setHostedWorkflows] = useState<HostedWorkflowMetadata[]>(() => initialCache?.hostedWorkflows ?? []);
const [lastUsedAt, setLastUsedAt] = useState<StoredWorkflowLastUsedAt>(() =>
  buildWorkflowOrderingTimestamps(
    initialCache?.workflows ?? [],
    initialCache?.hostedWorkflows ?? [],
    readStoredWorkflowLastUsedMap(),
  ),
);
const [pinnedLookup, setPinnedLookup] = useState<StoredWorkflowPinnedLookup>(() =>
  readStoredWorkflowPinnedLookup(),
);
// ... more workflow-related state
```

**After:**
```typescript
const {
  workflows,
  hostedWorkflows,
  lastUsedAt,
  pinnedLookup,
  hostedLoading,
  hostedError,
  workflowsRef,
  hostedWorkflowsRef,
  workflowSortCollatorRef,
  hasLoadedWorkflowsRef,
  setWorkflows,
  setHostedWorkflows,
  setLastUsedAt,
  setHostedLoading,
  setHostedError,
  toggleLocalPin,
  toggleHostedPin,
  persistPinnedLookup,
} = useWorkflowState({
  initialCache,
  selectedWorkflowId,
});
```

**Lines to remove:** ~30-40 lines of state declarations and useEffect hooks

#### 2.2 Replace Flow State (Lines ~500-540)

**Before:**
```typescript
const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
const [edges, setEdges, applyEdgesChange] = useEdgesState<FlowEdgeData>([]);
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
// ... decorateNode function
```

**After:**
```typescript
const {
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  setNodes,
  setEdges,
  setSelectedNodeId,
  setSelectedEdgeId,
  onNodesChange,
  applyEdgesChange,
  decorateNode,
  decorateNodes,
} = useFlowState();
```

**Lines to remove:** ~20-30 lines

#### 2.3 Replace Version State

**Before:**
```typescript
const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
const draftVersionIdRef = useRef<number | null>(null);
```

**After:**
```typescript
const {
  versions,
  selectedVersionId,
  draftVersionIdRef,
  setVersions,
  setSelectedVersionId,
} = useVersionState();
```

#### 2.4 Replace Save State

**Before:**
```typescript
const [saveState, setSaveState] = useState<SaveState>("idle");
const [saveMessage, setSaveMessage] = useState<string | null>(null);
const autoSaveTimerRef = useRef<number | null>(null);
const pendingChangesRef = useRef<boolean>(false);
```

**After:**
```typescript
const {
  saveState,
  saveMessage,
  autoSaveTimerRef,
  pendingChangesRef,
  setSaveState,
  setSaveMessage,
} = useSaveState();
```

#### 2.5 Replace Modal State

**Before:**
```typescript
const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
// ... more modal states
```

**After:**
```typescript
const {
  isDeployModalOpen,
  isCreatingWorkflow,
  isCreateModalOpen,
  isAppearanceModalOpen,
  appearanceTarget,
  openWorkflowMenuId,
  workflowMenuPlacement,
  isMobileActionsOpen,
  setIsDeployModalOpen,
  setIsCreatingWorkflow,
  setIsCreateModalOpen,
  setIsAppearanceModalOpen,
  setAppearanceTarget,
  setOpenWorkflowMenuId,
  setWorkflowMenuPlacement,
  setIsMobileActionsOpen,
  closeWorkflowMenu,
  openAppearanceModal,
} = useModalState();
```

#### 2.6 Replace Resources State

**Before:**
```typescript
const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
const [availableModelsLoading, setAvailableModelsLoading] = useState(false);
const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);
// ... vectorStores, widgets, etc.
```

**After:**
```typescript
const {
  availableModels,
  availableModelsLoading,
  availableModelsError,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  availableWidgets,
  availableWidgetsLoading,
  availableWidgetsError,
  setAvailableModels,
  setAvailableModelsLoading,
  setAvailableModelsError,
  setVectorStores,
  setVectorStoresLoading,
  setVectorStoresError,
  setAvailableWidgets,
  setAvailableWidgetsLoading,
  setAvailableWidgetsError,
} = useResourcesState();
```

#### 2.7 Replace Viewport State

**Before:**
```typescript
const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null);
const blockLibraryScrollRef = useRef<HTMLDivElement | null>(null);
const transformUpdateFrameRef = useRef<number | null>(null);
```

**After:**
```typescript
const {
  reactFlowWrapperRef,
  blockLibraryScrollRef,
  transformUpdateFrameRef,
  // ... other refs
} = useViewportState();
```

#### 2.8 Replace Media Query

**Before:**
```typescript
const [isMobileLayout, setIsMobileLayout] = useState<boolean>(() => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 768px)").matches;
});

useEffect(() => {
  // ... media query listener
}, []);
```

**After:**
```typescript
const isMobileLayout = useMediaQuery("(max-width: 768px)");
```

**Lines to remove:** ~20-30 lines

### Step 3: Replace API Calls with Services

#### 3.1 Initialize Services

Add at the top of the component:

```typescript
const workflowService = useMemo(
  () => new WorkflowService(backendUrl, authHeader),
  [backendUrl, authHeader]
);

const versionService = useMemo(
  () => new VersionService(backendUrl, authHeader),
  [backendUrl, authHeader]
);

const importExportService = useMemo(
  () => new ImportExportService(backendUrl, authHeader),
  [backendUrl, authHeader]
);
```

#### 3.2 Replace loadWorkflows Function

**Before:**
```typescript
const loadWorkflows = useCallback(async (options?: { suppressLoadingState?: boolean }) => {
  // ... ~100 lines of API calls and state updates
}, [dependencies]);
```

**After:**
```typescript
const loadWorkflows = useCallback(async (options?: { suppressLoadingState?: boolean }) => {
  if (!options?.suppressLoadingState) {
    setLoading(true);
  }

  try {
    const workflows = await workflowService.fetchWorkflows();
    setWorkflows(workflows);
    hasLoadedWorkflowsRef.current = true;
    // ... rest of logic
  } catch (error) {
    setLoadError(error.message);
  } finally {
    setLoading(false);
  }
}, [workflowService, /* other dependencies */]);
```

**Lines to remove:** ~50-70 lines of fetch logic

#### 3.3 Replace Other API Functions

Similar pattern for:
- `handleCreateWorkflow` → `workflowService.createWorkflow()`
- `handleDeleteWorkflow` → `workflowService.deleteWorkflow()`
- `handleDuplicateWorkflow` → `workflowService.duplicateWorkflow()`
- `handleRenameWorkflow` → `workflowService.renameWorkflow()`
- `loadVersions` → `versionService.fetchVersions()`
- `handleExportWorkflow` → `importExportService.exportWorkflow()`
- `handleImportFileChange` → `importExportService.importWorkflow()`

**Estimated lines to remove:** ~200-300 lines of API logic

### Step 4: Replace Inline JSX with Components

#### 4.1 Replace Save Toast

**Before (Line ~8000+):**
```typescript
{saveMessage ? (
  <div
    style={{
      position: "fixed",
      top: "1rem",
      right: "1rem",
      // ... inline styles
    }}
  >
    {saveMessage}
  </div>
) : null}
```

**After:**
```typescript
{saveMessage ? (
  <SaveToast saveState={saveState} saveMessage={saveMessage} />
) : null}
```

**Lines to remove:** ~30-40 lines

#### 4.2 Replace Deploy Modal

**Before (Lines ~8300+):**
```typescript
{isDeployModalOpen ? (
  <div className={styles.modalOverlay}>
    <div className={styles.modalContent}>
      {/* ~100 lines of modal content */}
    </div>
  </div>
) : null}
```

**After:**
```typescript
<DeployModal
  isOpen={isDeployModalOpen}
  isDeploying={isDeploying}
  deployToProduction={deployToProduction}
  versionSummaryForPromotion={versionSummaryForPromotion}
  isPromotingDraft={isPromotingDraft}
  onClose={() => setIsDeployModalOpen(false)}
  onConfirm={handleConfirmDeploy}
  onProductionToggle={setDeployToProduction}
  t={t}
/>
```

**Lines to remove:** ~100-150 lines

#### 4.3 Replace Properties Panel

**Before (Lines ~7800+):**
```typescript
{(selectedNodeId || selectedEdgeId) && !isMobileLayout ? (
  <aside className={styles.propertiesPanel}>
    <header className={styles.propertiesPanelHeader}>
      {/* header content */}
    </header>
    <div className={styles.propertiesPanelBody}>
      {selectedNodeId ? <NodeInspector /> : <EdgeInspector />}
    </div>
  </aside>
) : null}
```

**After:**
```typescript
{(selectedNodeId || selectedEdgeId) ? (
  <PropertiesPanel
    isMobileLayout={isMobileLayout}
    selectedElementLabel={selectedElementLabel}
    floatingPanelStyle={floatingPanelStyle}
    onClose={clearSelection}
    closeButtonRef={closeButtonRef}
  >
    {selectedNodeId ? (
      <NodeInspector {...nodeInspectorProps} />
    ) : (
      <EdgeInspector {...edgeInspectorProps} />
    )}
  </PropertiesPanel>
) : null}
```

**Lines to remove:** ~40-60 lines

#### 4.4 Replace Block Library Panel

**Before (Lines ~7600+):**
```typescript
{/* ~150 lines of block library rendering */}
```

**After:**
```typescript
<BlockLibraryPanel
  isMobileLayout={isMobileLayout}
  isOpen={isBlockLibraryOpen}
  items={blockLibraryItems}
  loading={loading}
  selectedWorkflowId={selectedWorkflowId}
  onToggle={toggleBlockLibrary}
  toggleRef={blockLibraryToggleRef}
  scrollRef={blockLibraryScrollRef}
  itemRefs={blockLibraryItemRefs}
  onItemRefSet={handleBlockLibraryItemRef}
  contentId="block-library-content"
/>
```

**Lines to remove:** ~150-200 lines

#### 4.5 Replace Workflow Header

**Before (Lines ~8090+):**
```typescript
<header style={headerStyle}>
  <button onClick={openSidebar}>...</button>
  {renderHeaderControls()}
</header>
```

**After:**
```typescript
<WorkflowHeader
  isMobileLayout={isMobileLayout}
  loading={loading}
  isImporting={isImporting}
  isExporting={isExporting}
  isDeploying={isDeploying}
  selectedWorkflowId={selectedWorkflowId}
  selectedVersionId={selectedVersionId}
  versions={versions}
  selectedWorkflow={selectedWorkflow}
  draftVersionIdRef={draftVersionIdRef}
  draftDisplayName={draftDisplayName}
  isMobileActionsOpen={isMobileActionsOpen}
  headerStyle={headerStyle}
  onOpenSidebar={openSidebar}
  onVersionChange={handleVersionChange}
  onTriggerImport={handleTriggerImport}
  onImportFileChange={handleImportFileChange}
  onExportWorkflow={handleExportWorkflow}
  onOpenDeployModal={handleOpenDeployModal}
  onToggleMobileActions={() => setIsMobileActionsOpen(!isMobileActionsOpen)}
  onCloseMobileActions={() => setIsMobileActionsOpen(false)}
  mobileActionsTriggerRef={mobileActionsTriggerRef}
  mobileActionsMenuRef={mobileActionsMenuRef}
  importFileInputRef={importFileInputRef}
  t={t}
/>
```

**Lines to remove:** ~200-250 lines (including renderHeaderControls function)

#### 4.6 Replace Workflow Sidebar

**Before (Lines ~6900+):**
```typescript
const workflowSidebarContent = useMemo(() => {
  // ~500 lines of sidebar rendering
}, [dependencies]);

useEffect(() => {
  setSidebarContent(workflowSidebarContent);
  setCollapsedSidebarContent(collapsedWorkflowShortcuts);
  return () => clearSidebarContent();
}, [workflowSidebarContent, collapsedWorkflowShortcuts]);
```

**After:**
```typescript
const { expandedContent, collapsedContent } = WorkflowSidebar({
  workflows,
  hostedWorkflows,
  selectedWorkflowId,
  selectedWorkflow,
  loading,
  loadError,
  hostedLoading,
  hostedError,
  isCreatingWorkflow,
  isMobileLayout,
  isSidebarCollapsed,
  pinnedLookup,
  lastUsedAt,
  openWorkflowMenuId,
  workflowMenuPlacement,
  onSelectWorkflow: handleSelectWorkflow,
  onOpenCreateModal: handleOpenCreateModal,
  onDuplicateWorkflow: handleDuplicateWorkflow,
  onRenameWorkflow: handleRenameWorkflow,
  onExportWorkflow: (id) => handleExportWorkflow(id),
  onDeleteWorkflow: handleDeleteWorkflow,
  onDeleteHostedWorkflow: handleDeleteHostedWorkflow,
  onToggleLocalPin: toggleLocalPin,
  onToggleHostedPin: toggleHostedPin,
  onCloseWorkflowMenu: closeWorkflowMenu,
  onSetOpenWorkflowMenuId: setOpenWorkflowMenuId,
  onSetWorkflowMenuPlacement: setWorkflowMenuPlacement,
  onOpenAppearanceModal: openAppearanceModal,
  t,
});

useEffect(() => {
  setSidebarContent(expandedContent);
  setCollapsedSidebarContent(collapsedContent);
  return () => clearSidebarContent();
}, [expandedContent, collapsedContent, setSidebarContent, setCollapsedSidebarContent, clearSidebarContent]);
```

**Lines to remove:** ~500-600 lines

### Step 5: Remove Duplicate Helper Functions

Remove helper functions that are now in extracted modules:

- `decorateNode` → now in `useFlowState`
- `toggleLocalPin`, `toggleHostedPin` → now in `useWorkflowState`
- Various style getter functions → already in `styles.ts`
- Constants → now in `utils-internal/constants.ts`

**Estimated lines to remove:** ~100-150 lines

## Expected Results

### Before Migration
- **Total lines**: 8,489
- **State declarations**: ~150 lines
- **API logic**: ~400 lines
- **Inline JSX**: ~1,500 lines
- **Helper functions**: ~200 lines

### After Migration
- **Total lines**: ~3,000-4,000
- **Hook calls**: ~50 lines
- **Service initialization**: ~20 lines
- **Component usage**: ~300 lines
- **Business logic**: ~2,000 lines (irreducible complexity)

### Line Reduction Breakdown
- State → Hooks: -150 lines
- API logic → Services: -400 lines
- Inline JSX → Components: -1,500 lines
- Helper functions: -200 lines
- **Total reduction**: ~2,250 lines (~26% reduction)
- **Additional cleanup**: ~2,000 lines (removing duplicates, simplifying)
- **Final reduction**: ~4,000-5,000 lines (~50-60% reduction)

## Testing Strategy

After each step:
1. Check TypeScript compilation: `npm run type-check`
2. Run the development server: `npm run dev`
3. Manually test the workflow builder:
   - Create a workflow
   - Edit a workflow
   - Add/remove nodes
   - Deploy a version
   - Import/Export
4. Check browser console for errors
5. Test responsive layout (mobile/desktop)

## Rollback Strategy

If issues are encountered:
1. Each step is committed separately
2. Can revert to previous commit: `git revert <commit-hash>`
3. Or reset to before migration: `git reset --hard <commit-hash>`

## Notes

- **Priority**: Stability over line count reduction
- **Risk**: High - this is the main component
- **Testing**: Manual testing required after each major step
- **Timeline**: Should be done incrementally over multiple sessions
- **Backup**: Ensure branch is pushed before starting

## Current Progress

- ✅ Phase 1: Hooks extracted
- ✅ Phase 2: Utils extracted
- ✅ Phase 3: Services extracted
- ✅ Phase 4: Components extracted
- ✅ Phase 5: Performance optimization
- ⏳ **Phase 6: Migration** (this document)
- ⬜ Phase 7: Testing
