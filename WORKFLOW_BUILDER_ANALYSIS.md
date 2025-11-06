# WorkflowBuilderPage.tsx - Comprehensive Code Analysis

## File Overview
- **Location:** `/home/user/test-chatkit/frontend/src/features/workflow-builder/WorkflowBuilderPage.tsx`
- **Size:** 2,939 lines
- **Type:** React functional component
- **Complexity:** Very High

---

## Component Structure Summary

### Main Component
- **WorkflowBuilderPage** - A massive functional component that serves as the main UI for the workflow builder application

### Key Responsibilities
1. Graph visualization and editing (ReactFlow-based)
2. Workflow CRUD operations (Create, Read, Update, Delete)
3. Workflow versioning and deployment
4. Node/Edge manipulation and properties editing
5. Modal management (Create, Deploy, Appearance, etc.)
6. File import/export
7. Keyboard shortcuts and accessibility
8. Responsive layout (mobile/desktop)
9. Undo/redo history management
10. Sidebar and block library management

---

## Detailed Component Analysis

### 1. IMPORTS & DEPENDENCIES (Lines 1-204)

**External Libraries:**
- React (hooks, types, CSSProperties)
- ReactFlow (graph visualization library)
- Custom hooks (useAuth, useI18n, useAppLayout)
- Backend utilities (API endpoints, parameter resolvers)
- Workflow utilities (parameter getters/setters)
- Custom hooks (17 custom hooks imported)

**Custom Hooks Used:**
1. `useEscapeKeyHandler` - ESC key handling
2. `useOutsidePointerDown` - Outside click detection
3. `useWorkflowResources` - Load vectors/models/widgets
4. `useWorkflowSidebarState` - Sidebar state management
5. `useWorkflowKeyboardShortcuts` - Keyboard shortcuts
6. `useRemoteVersionPolling` - Poll for remote version changes
7. `useWorkflowHistory` - Undo/redo functionality
8. `useWorkflowBuilderModals` - Modal state management
9. `useWorkflowNodeHandlers` - Node manipulation handlers
10. `useGraphEditor` - Graph manipulation (copy/paste/delete)
11. `useWorkflowPersistence` - Save/load/import/export
12. `useWorkflowViewportPersistence` - Viewport memory

---

### 2. STATE MANAGEMENT

#### A. React State Variables (46+ useState/useRef/useCallback declarations)

**UI State:**
```
- loading: boolean
- loadError: string | null
- saveState: SaveState ("idle" | "saving" | "saved" | "error")
- saveMessage: string | null
- selectedNodeId: string | null
- selectedEdgeId: string | null
- hostedLoading: boolean
- hostedError: string | null
- versions: WorkflowVersionSummary[]
- selectedVersionDetail: WorkflowVersionResponse | null
- selectedVersionId: number | null
- hasPendingChanges: boolean
- minViewportZoom: number
- initialViewport: Viewport | undefined
```

**Workflow Management State:**
```
- openWorkflowMenuId: string | number | null
- createWorkflowKind: "local" | "hosted"
- createWorkflowName: string
- createWorkflowRemoteId: string
- createWorkflowError: string | null
- isCreatingWorkflow: boolean
- deployToProduction: boolean
- isDeploying: boolean
- isExporting: boolean
- isImporting: boolean
- workflowMenuPlacement: ActionMenuPlacement
```

**Panel State:**
```
- isBlockLibraryOpen: boolean
- isPropertiesPanelOpen: boolean
```

**Graph State (from ReactFlow):**
```
- nodes: FlowNode[]
- edges: FlowEdge[]
- onNodesChange: NodeChange[] handler
- applyEdgesChange: EdgeChange[] handler
```

#### B. Ref Storage (15+ useRef declarations)

**References for Tracking:**
```
- lastSavedSnapshotRef: current saved graph snapshot
- draftVersionIdRef: draft version ID
- draftVersionSummaryRef: draft version summary
- versionsRef: versions list cache
- selectedWorkflowIdRef: selected workflow
- hasPendingChangesRef: pending changes cache
- saveStateRef: save state cache
- selectedVersionIdRef: selected version
- isCreatingDraftRef: draft creation flag
- isHydratingRef: loading flag
- reactFlowInstanceRef: ReactFlow instance
- viewportRef: current viewport
- viewportMemoryRef: Map of saved viewports
- viewportKeyRef: current viewport key
- hasUserViewportChangeRef: user changed viewport flag
- pendingViewportRestoreRef: viewport restore flag
- reactFlowWrapperRef: DOM reference
- importFileInputRef: file input reference
- blockLibraryToggleRef: button reference
- propertiesPanelToggleRef: button reference
- propertiesPanelCloseButtonRef: button reference
- previousSelectedElementRef: last selected element
- selectedNodeIdRef: cache of selected node
- selectedEdgeIdRef: cache of selected edge
- lastTappedElementRef: double-tap tracking
- selectedNodeIdsRef: Set of selected nodes
- selectedEdgeIdsRef: Set of selected edges
- isNodeDragInProgressRef: drag state
- copySequenceRef: copy sequence tracking
- workflowBusyRef: workflow busy flag
- nodesRef: nodes cache
- edgesRef: edges cache
- workflowMenuTriggerRef: menu button reference
- workflowMenuRef: menu reference
- mobileActionsTriggerRef: mobile actions reference
- mobileActionsMenuRef: mobile actions menu reference
- appearanceModalTriggerRef: appearance modal trigger
```

#### C. External State Management (from custom hooks)

- **useWorkflowSidebarState:** workflows, hostedWorkflows, pinnedLookup, selectedWorkflowId
- **useWorkflowResources:** vectorStores, availableModels, widgets (each with loading/error states)
- **useWorkflowHistory:** historyRef, undo/redo functions
- **useWorkflowBuilderModals:** modal states for create/deploy/appearance
- **useGraphEditor:** selection management, copy/paste/delete operations
- **useWorkflowPersistence:** save/load/import/export handlers
- **useWorkflowViewportPersistence:** viewport persistence

---

### 3. MAIN HANDLERS & FUNCTIONS (60+ handlers)

#### A. Data Loading Functions

1. **loadVersionDetail()** (Lines 730-878)
   - Complex async function with error handling
   - Fetches workflow version from API
   - Transforms API response to ReactFlow format
   - Manages viewport persistence
   - Updates history and pending changes state
   - ~150 lines of complex logic

2. **loadVersions()** (Lines 919-1090)
   - Loads versions for a selected workflow
   - Complex version selection logic
   - Handles draft vs. production versions
   - Calls loadVersionDetail recursively
   - ~170 lines

3. **loadWorkflows()** (Lines 1092-1220)
   - Fetches local workflows from API
   - Handles workflow selection
   - Manages empty state
   - ~130 lines

4. **loadHostedWorkflows()** (Lines 1222-1249)
   - Fetches hosted workflows (requires auth)
   - Simple async function
   - ~30 lines

#### B. Graph Manipulation Handlers

1. **onConnect()** (Lines 1275-1295)
   - Creates new edge connection
   - Sets pending changes flag

2. **handleNodesChange()** (Lines 386-391)
   - Updates node positions/selection
   - Delegates to ReactFlow handler

3. **handleEdgesChange()** (Lines 393-401)
   - Updates edge state
   - Marks changes as pending

4. **handleNodeClick()** (Lines 1307-1320)
   - Handles node selection
   - Implements double-tap detection for mobile

5. **handleEdgeClick()** (Lines 1322-1335)
   - Handles edge selection
   - Implements double-tap detection for mobile

6. **handleConditionChange()** (Lines 1509-1525)
   - Updates edge condition/label
   - Marks changes as pending

7. **handleEdgeLabelChange()** (Lines 1527-1546)
   - Updates edge metadata label
   - Marks changes as pending

8. **handleRemoveNode()** (Lines 1549-1571)
   - Removes node with confirmation dialog
   - Updates selection
   - Marks changes as pending

9. **handleRemoveEdge()** (Lines 1573-1583)
   - Removes edge
   - Updates selection
   - Marks changes as pending

#### C. Node/Edge Updates

1. **updateNodeData()** (Lines 1462-1478)
   - Updates node data for a specific node
   - Applies decorator styling

2. **addNodeToGraph()** (Lines 1480-1498)
   - Adds new node to graph
   - Auto-selects the new node
   - Clears previous selection

#### D. Workflow Management Handlers

1. **handleSelectWorkflow()** (Lines 1604-1628)
   - Switches active workflow
   - Loads versions for new workflow
   - Handles mobile layout sidebar

2. **handleVersionChange()** (Lines 1630-1646)
   - Changes active workflow version
   - Manages viewport restoration

3. **handleSubmitCreateWorkflow()** (Lines 1659-1744)
   - Creates new workflow (local or hosted)
   - Complex validation and API calls
   - ~85 lines of nested logic

4. **handleDeleteWorkflow()** (Lines 1770-1865)
   - Deletes workflow with confirmation
   - Complex API error handling
   - ~95 lines

5. **handleDeleteHostedWorkflow()** (Lines 1867-1906)
   - Deletes hosted workflow
   - Uses ChatKit API
   - ~40 lines

6. **handleDuplicateWorkflow()** (Lines 1969-2047)
   - Duplicates existing workflow
   - Prompts for new name
   - Complex creation logic
   - ~80 lines

7. **handleRenameWorkflow()** (Lines 2049-2135)
   - Renames workflow
   - Multiple endpoint candidates
   - Error handling
   - ~85 lines

#### E. Deployment Handlers

1. **handleConfirmDeploy()** (Lines 2286-2390)
   - Complex deployment/promotion logic
   - Saves pending changes first
   - Resolves version to promote
   - Handles draft promotion
   - ~105 lines of nested async logic

2. **resolveVersionIdToPromote()** (Lines 2263-2284)
   - Determines which version to deploy
   - Handles draft vs. selected version logic
   - ~20 lines

#### F. Properties Panel Handlers

1. **handleOpenPropertiesPanel()** (Lines 1377-1382)
   - Opens properties panel

2. **handleClosePropertiesPanel()** (Lines 1362-1375)
   - Closes properties panel
   - Mobile-specific logic

#### G. Library & UI Handlers

1. **toggleBlockLibrary()** (Lines 450-452)
   - Toggles block library visibility

2. **closeBlockLibrary()** (Lines 453-461)
   - Closes block library
   - Optional focus management

3. **renderHeaderControls()** (Lines 626-679)
   - Renders header with version selector
   - Import/export/deploy buttons
   - ~55 lines of JSX

4. **renderWorkflowDescription()** (Lines 598-610)
   - Renders description text

5. **renderWorkflowPublicationReminder()** (Lines 612-624)
   - Renders publication reminder

#### H. Drag/Drop Handlers

1. **handleNodeDragStart()** (Lines 1341-1343)
   - Marks drag in progress

2. **handleNodeDragStop()** (Lines 1345-1360)
   - Commits drag changes to history
   - Complex history management
   - ~15 lines

3. **reactFlowContainerRef()** (Lines 681-689)
   - Callback ref for container
   - Triggers viewport refresh

#### I. Selection & History Handlers

1. **handleClearSelection** (Line 1337)
   - Clears all selections

2. **handleSelectionChange** (Line 1339)
   - Handles ReactFlow selection changes

3. **undoHistory** / **redoHistory** (from useWorkflowHistory)
   - Undo/redo operations

#### J. Modal & Menu Handlers

1. **closeWorkflowMenu()** (Lines 308-313)
   - Closes workflow dropdown menu
   - Resets refs

2. **handleOpenCreateModalWithReset()** (Lines 1649-1655)
   - Opens create workflow modal
   - Resets form state

3. **handleOpenDeployModalWithSetup()** (Lines 1957-1961)
   - Opens deploy modal
   - Sets production flag

#### K. File Operations (from useWorkflowPersistence)

1. **handleSave()** - Saves workflow (auto or manual)
2. **handleImportFileChange()** - Handles file upload
3. **handleTriggerImport()** - Triggers import dialog
4. **handleExportWorkflow()** - Exports workflow as JSON

#### L. Keyboard Shortcuts (from useWorkflowKeyboardShortcuts)

- Undo/Redo (Ctrl+Z, Ctrl+Y)
- Copy (Ctrl+C)
- Paste (Ctrl+V)
- Delete (Delete/Backspace)
- Duplicate (Ctrl+D)

---

### 4. COMPLEX BUSINESS LOGIC

#### A. Pending Changes Tracking

```javascript
const updateHasPendingChanges = useCallback(...)
// Tracks unsaved changes across:
// - Node position changes
// - Edge/node modifications
// - Parameter updates
// Prevents deployment with pending changes
```

#### B. Graph Snapshot & History

```javascript
const graphSnapshot = useMemo(() => 
  JSON.stringify(buildGraphPayload()), 
  [buildGraphPayload]
)
// Deep equality tracking for changes
// Drives history (undo/redo)
```

**Complex History Logic** (Lines 1915-1952):
- Tracks pending snapshot during drag
- Updates history after drag completes
- Manages past/future stacks with HISTORY_LIMIT
- ~40 lines of intricate state management

#### C. Viewport Memory Management

- Saves viewport per workflow version
- Key: `viewportKeyFor(workflowId, versionId, deviceType)`
- Restores viewport when switching versions
- Handles responsive layout changes
- ~60 lines of logic across multiple functions

#### D. Mobile vs Desktop Layout

```javascript
const isMobileLayout = useMediaQuery("(max-width: 768px)")
const deviceType: DeviceType = isMobileLayout ? "mobile" : "desktop"
```

**Mobile-Specific Features:**
- Different block library behavior
- Properties panel as modal
- Mobile actions menu
- Responsive styling calculations
- Double-tap to open properties (vs. auto-open on selection)

#### E. Draft Version Management

- Tracks draft version separately from published versions
- Creates draft on first save
- Allows publishing draft to production
- Handles draft vs. selected version resolution
- ~30 lines in loadVersions()

#### F. Save State Machine

States: `"idle" | "saving" | "saved" | "error"`
- Toast notification display
- Automatic state reset after 1.5 seconds
- Error message preservation
- Associated with save operations

#### G. Validation & Constraints

1. **Graph Structure Validation** (Line 1954)
   ```javascript
   const conditionGraphError = useMemo(() => 
     validateGraphStructure(nodes, edges), 
     [edges, nodes]
   )
   ```

2. **Save Disablement Logic** (Lines 2137-2211)
   - Checks for parameter errors in nodes
   - Validates graph structure
   - Validates vector store references
   - Validates widget references
   - ~75 lines of complex validation

3. **Deployment Constraints**
   - No pending changes allowed
   - Must have version to promote
   - Must have selected workflow
   - Version must exist

#### H. Viewport Responsiveness

**Complex responsive logic** (Lines 2690-2750):
- Calculates min viewport zoom based on layout
- Adjusts workspace padding based on layout
- Dynamically positions floating panels
- Different editor container styles
- Responsive header height (`headerOverlayOffset`)

---

### 5. API INTEGRATION

#### A. Multiple Endpoint Candidates

```javascript
const candidates = makeApiEndpointCandidates(backendUrl, endpoint)
for (const url of candidates) {
  try {
    // Retry logic
  } catch (error) {
    // Continue to next candidate
  }
}
```

**Pattern Used In:**
- `loadVersionDetail()` - Fetches workflow version
- `loadWorkflows()` - Fetches local workflows
- `handleDeleteWorkflow()` - Deletes workflow
- `handleRenameWorkflow()` - Renames workflow
- `handleConfirmDeploy()` - Promotes version

#### B. Auth Header Management

```javascript
const authHeader = useMemo(
  () => (token ? { Authorization: `Bearer ${token}` } : {}),
  [token],
)
```

#### C. ChatKit API Integration

- `chatkitApi.createHostedWorkflow(token, {...})`
- `chatkitApi.deleteHostedWorkflow(token, slug)`
- `chatkitApi.getHostedWorkflows(token, { cache: false })`
- Cache invalidation on mutations

---

### 6. USEEFFECT DEPENDENCIES & SYNCHRONIZATION

**Total useEffect hooks: 15+**

**Key Effects:**

1. **Initialize on Mount** (Line 1252)
   - Loads workflows on component mount

2. **Layout Responsiveness** (Lines 463-469)
   - Updates block library on layout change
   - Closes mobile actions on layout change

3. **Ref Synchronization** (Lines 479-507)
   - Keeps refs in sync with state:
     - `nodesRef` ↔ `nodes`
     - `edgesRef` ↔ `edges`
     - `versionsRef` ↔ `versions`
     - `hasPendingChangesRef` ↔ `hasPendingChanges`
     - `saveStateRef` ↔ `saveState`
     - `selectedWorkflowIdRef` ↔ `selectedWorkflowId`
     - `selectedVersionIdRef` ↔ `selectedVersionId`
     - `selectedNodeIdRef` ↔ `selectedNodeId`
     - `selectedEdgeIdRef` ↔ `selectedEdgeId`

4. **Reset Draft on Workflow Change** (Lines 493-495)
   - Clears draft when switching workflows

5. **Keyboard Handlers** (Lines 509-527)
   - ESC key closes block library
   - ESC key closes mobile actions

6. **Menu Coordination** (Lines 537-547)
   - Closes workflow menu when block library closes
   - Closes workflow menu when workflows list changes

7. **Outside Click Detection** (Lines 549-555)
   - Closes workflow menu on outside click
   - Closes mobile actions on outside click

8. **Window Resize Handler** (Lines 691-702)
   - Updates viewport constraints on resize
   - Adds/removes event listener

9. **Viewport Updates** (Lines 704-706)
   - Refreshes constraints when nodes or layout changes

10. **Graph History Management** (Lines 1915-1952)
    - Updates undo/redo history based on snapshot changes
    - Complex pending snapshot logic

11. **Selection Display** (Lines 1386-1443)
    - Opens/closes properties panel based on selection
    - Mobile-specific double-tap behavior
    - Manages focus for accessibility

12. **Remote Version Polling** (Lines 1257-1269)
    - Custom hook for polling server for version changes

13. **Hosted Workflows Load** (Lines 1272-1273)
    - Loads hosted workflows on mount

14. **Modal Escape Handler** (Lines 1965-1967)
    - Closes deploy modal on ESC

---

### 7. RENDERING & STYLING

#### A. Complex Styling Calculations

**Multiple useMemo blocks for styling:**

1. **headerOverlayOffset** (Lines 2570-2573)
   - Mobile: `"4rem"`, Desktop: `"4.25rem"`

2. **floatingPanelStyle** (Lines 2575-2584)
   - Dynamic positioning based on header height
   - Mobile-aware calculation
   - ~10 lines

3. **toastStyles** (Lines 2647-2674)
   - Switch statement for save state colors
   - ~30 lines of inline styles

4. **headerStyle** (Lines 2680-2683)
   - Gets base header style
   - Adds positioning

5. **headerNavigationButtonStyle** (Lines 2685-2688)
   - Device-type aware styling

6. **workspaceWrapperStyle** (Lines 2690-2695)
   - Mobile: absolute positioning
   - Desktop: flex layout

7. **workspaceContentStyle** (Lines 2697-2730)
   - Most complex styling (~35 lines)
   - Conditional padding based on description/reminder
   - Dynamic gap calculation
   - Device-type aware

8. **editorContainerStyle** (Lines 2732-2770)
   - Responsive border radius
   - Conditional shadow
   - Dynamic margin calculation
   - ~40 lines

#### B. Main JSX Structure

**Provider Wrapping:**
```jsx
<ReactFlowProvider>
  <WorkflowBuilderSidebar {...props} />
  <div style={mainContainerStyle}>
    <WorkflowBuilderCanvas {...props} />
    <toast message />
    <WorkflowAppearanceModal {...props} />
    <CreateWorkflowModal {...props} />
    <DeployWorkflowModal {...props} />
  </div>
</ReactFlowProvider>
```

**Component Props Passed:**
- **WorkflowBuilderCanvas:** 50+ props
- **WorkflowBuilderSidebar:** 20+ props
- **NodeInspector:** 15+ props
- **EdgeInspector:** 5+ props
- **BlockLibrary:** 10+ props

---

### 8. PERFORMANCE ISSUES & OPTIMIZATIONS

#### Current Issues:

1. **Massive State Surface**
   - 46+ state variables at top level
   - Each causes re-renders

2. **Prop Drilling**
   - Passes 50+ props to WorkflowBuilderCanvas
   - Many are refs and callbacks
   - Makes component testing difficult

3. **Callback Dependencies**
   - Many useCallback functions with large dependency arrays
   - Example: `handleConfirmDeploy` has 9 dependencies
   - Risk of stale closures

4. **Repeated Memoization**
   - Multiple useMemo blocks for styling
   - Some could be extracted to CSS
   - ~15 useMemo blocks visible

5. **Ref Synchronization Overhead**
   - Syncs 10+ values to refs with useEffect
   - Each sync is a separate effect
   - Could be combined

6. **Graph Snapshot Stringification**
   - `JSON.stringify(buildGraphPayload())` on every render
   - Deep equality comparison through string comparison
   - Expensive operation

7. **Potential Memory Leaks**
   - `viewportMemoryRef` uses Map that grows indefinitely
   - No cleanup of old viewport keys
   - Could accumulate entries for deleted workflows

8. **API Call Retry Loop**
   - Loops through multiple endpoint candidates
   - Each loop can make async fetch call
   - No cancellation tokens
   - Race conditions possible with rapid switches

#### Optimization Opportunities:

1. **Extract State to Context**
   - Workflow management state
   - Sidebar state
   - Modal state
   - Version state

2. **Lazy Load Modals**
   - Only create modal components when needed

3. **Memoize Computed Values**
   - Style calculations already memoized
   - Graph payload could be memoized differently

4. **Use Callback Refs for Heavy Calculations**
   - GraphSnapshot could use useCallback ref

5. **Split Component**
   - Current: 2,939 lines in one file
   - Should be: 5-7 focused components
   - Extract modals
   - Extract sidebar
   - Extract canvas wrapper
   - Extract properties panel

6. **Add Request Cancellation**
   - Use AbortController for fetch calls
   - Cancel on unmount or navigation

---

### 9. CODE SMELLS & ISSUES

#### A. Magic Numbers

```javascript
- HISTORY_LIMIT (imported, probably 50)
- 768px for mobile breakpoint (hardcoded)
- 100ms delay for isHydrating timeout
- 1500ms for save message dismissal
- 2 for double-tap count threshold
- 1.25rem border radius (hardcoded)
```

#### B. Hardcoded Strings

```javascript
- French text in several places: "Suppression en cours…", "Sélectionnez le workflow..."
- Error messages mixed with i18n
- CSS class names mixed with variables
```

#### C. Complex Nested Logic

```javascript
// handleConfirmDeploy has 3-4 levels of nesting
if (!selectedWorkflowId) return;
if (hasPendingChanges) {
  await handleSave();
  if (hasPendingChanges) {
    if (!versionIdToPromote) {
      ...
    }
  }
}
```

#### D. Side Effects in Renders

```javascript
// Lines 463-476 have multiple effects that should be combined
// Different concerns scattered across multiple useEffect calls
```

#### E. Mixed Responsibilities

1. **Node decoration**
   - `decorateNode` called in multiple places
   - Logic duplicated in rendering and updating

2. **Selection management**
   - Scattered across multiple handlers
   - Multiple selection types (node, edge, multiple)
   - Complex logic in effects

3. **Viewport management**
   - Mixed with graph loading
   - Mixed with layout responsiveness
   - Multiple overlapping concerns

#### F. Potential Bugs

1. **Race Conditions**
   - Multiple async operations on same workflow
   - `isHydratingRef` flag might miss updates
   - Draft resolution could be stale

2. **Viewport Key Issues**
   - Key changes on device orientation
   - Old viewports not cleaned up
   - Could restore wrong viewport

3. **Modal State Sync**
   - Modal states could get out of sync
   - No validation that only one modal is open
   - Multiple modal triggers could interfere

#### G. Missing Error Handling

```javascript
// Some async operations don't catch all errors
// Some await calls could throw but aren't wrapped
```

#### H. Accessibility Issues

1. **ARIA Labels**
   - Some buttons missing aria-label
   - Dialog implementation might not be fully accessible
   - Focus management could be improved

2. **Keyboard Navigation**
   - Tab order might be confusing
   - No visible focus indicators mentioned
   - Complex tab trap logic in modals

---

### 10. COMPLEXITY BREAKDOWN

#### Cyclomatic Complexity

**High Complexity Functions:**
1. `loadVersionDetail()` - ~12-15 (multiple branches, error handling, viewport logic)
2. `loadVersions()` - ~10-12 (version resolution, selection logic)
3. `handleConfirmDeploy()` - ~10-12 (nested if statements)
4. `handleSubmitCreateWorkflow()` - ~8-10 (validation, API calls)
5. `disableSave()` calculation - ~8 (multiple validation paths)

#### Cognitive Complexity

**Most Complex Sections:**
1. **Graph History Management** (Lines 1915-1952) - Intricate state machine
2. **Viewport Restoration Logic** (Lines 826-848) - Multiple conditions
3. **Save Disablement Logic** (Lines 2137-2211) - Nested validation
4. **Layout Responsiveness** (Lines 2697-2730) - Multiple conditional styles

#### Scope/Coupling Issues

**Tightly Coupled:**
- Graph state (nodes/edges) directly tied to UI
- Viewport management intertwined with graph loading
- Selection state directly drives panel visibility
- Modal state depends on multiple parent props

**Loose Coupling:**
- Business logic well-separated in custom hooks
- API calls abstracted with endpoint candidates
- Styling somewhat separated in utils

---

## Refactoring Recommendations

### IMMEDIATE PRIORITIES

1. **Split Component (Highest Impact)**
   - Extract WorkflowBuilderCanvas wrapper
   - Extract SidebarPanel
   - Extract PropertiesPanelContainer
   - Extract ModalManager

2. **Extract State Management (High Impact)**
   - Create WorkflowContext for workflow/version state
   - Create SelectionContext for node/edge selection
   - Create SaveContext for save state
   - Create ModalContext for modal states

3. **Reduce Prop Drilling (Medium Impact)**
   - Use context for deeply nested props
   - Reduce WorkflowBuilderCanvas props from 50+ to 15-20

4. **Simplify Complex Functions (Medium Impact)**
   - Break down `loadVersionDetail()` into smaller functions
   - Extract version resolution logic
   - Extract viewport restoration logic

### SECONDARY PRIORITIES

5. **Add Request Cancellation (Medium Impact)**
   - Implement AbortController for API calls
   - Cancel on unmount/navigation

6. **Clean Up Ref Synchronization (Low-Medium Impact)**
   - Combine related ref syncs into single effect
   - Use custom hook for ref sync pattern

7. **Extract Constants (Low Impact)**
   - Extract magic numbers (768px, 100ms, 1500ms)
   - Extract frequently used strings

8. **Improve Type Safety (Low Impact)**
   - Create specific types for complex state
   - Add stricter typing for handler parameters

---

## Lines Breakdown

| Section | Lines | Notes |
|---------|-------|-------|
| Imports | 1-204 | 60+ imports, 17 custom hooks |
| State Setup | 205-600 | 46+ state variables, 15+ refs |
| Effects & Setup | 463-1273 | 15+ useEffect hooks, initialization |
| Loading Functions | 730-1249 | 3 major async functions |
| Graph Handlers | 1275-1595 | 10+ event handlers |
| Workflow Management | 1604-2135 | 6+ workflow CRUD handlers |
| Deploy/Validation | 2137-2390 | Complex deploy logic, validation |
| Block Library | 2392-2502 | 15 node types, library content |
| Styling & Layout | 2570-2750 | Multiple styling calculations |
| Rendering | 2752-2939 | Main JSX, modals, 200+ lines |

---

## Summary Statistics

- **Total Lines:** 2,939
- **State Variables:** 46+
- **Refs:** 35+
- **Event Handlers:** 20+
- **Async Functions:** 8+
- **Custom Hooks:** 12
- **Effects:** 15+
- **Memos:** 15+
- **Callbacks:** 30+
- **Modal Types:** 3 (Create, Deploy, Appearance)
- **Supported Node Types:** 15+
- **Props to Child Components:** 150+
- **Complexity Level:** VERY HIGH
- **Maintainability Index:** LOW
- **Cyclomatic Complexity Average:** 6-8 (High)

---
