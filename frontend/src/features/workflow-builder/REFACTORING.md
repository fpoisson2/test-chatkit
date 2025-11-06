# WorkflowBuilderPage Refactoring Plan

## Overview

This document outlines the refactoring plan for `WorkflowBuilderPage.tsx`, a large monolithic component (~8,489 lines) that needs to be broken down into smaller, more manageable pieces.

## Current State

- **Size**: 8,489 lines of code
- **States**: ~50 useState hooks
- **Total Hooks**: 229 hooks (useEffect, useCallback, useMemo)
- **Issues**:
  - Mixed responsibilities
  - Difficult to maintain and test
  - Poor code organization
  - Performance concerns

## Refactoring Strategy

### Phase 1: Extract Custom Hooks ✅ COMPLETED

Created specialized hooks to manage different aspects of state:

#### 1. `useWorkflowState` ✅
- Manages local and hosted workflows
- Handles pinning and ordering timestamps
- Location: `hooks/useWorkflowState.ts`

#### 2. `useFlowState` ✅
- Manages ReactFlow nodes and edges
- Handles node/edge selection
- Provides node decoration utilities
- Location: `hooks/useFlowState.ts`

#### 3. `useVersionState` ✅
- Manages workflow versions
- Tracks selected workflow and version
- Location: `hooks/useVersionState.ts`

#### 4. `useSaveState` ✅
- Manages save state and messages
- Tracks pending changes
- Handles autosave timing
- Location: `hooks/useSaveState.ts`

#### 5. `useModalState` ✅
- Manages all modal states (deploy, create, appearance)
- Handles workflow menu state
- Location: `hooks/useModalState.ts`

#### 6. `useResourcesState` ✅
- Manages external resources (vector stores, models, widgets)
- Handles loading and error states
- Location: `hooks/useResourcesState.ts`

#### 7. `useViewportState` ✅
- Manages ReactFlow viewport and persistence
- Tracks UI element refs
- Location: `hooks/useViewportState.ts`

#### 8. `useMediaQuery` ✅
- Media query matching hook
- Handles mobile/desktop detection
- Location: `hooks/useMediaQuery.ts`

### Phase 2: Extract Utilities ✅ COMPLETED

Organized utilities into logical modules in `utils-internal/`:

#### 1. `constants.ts` ✅
- Backend URL
- Viewport zoom constraints
- Layout constants
- History and autosave settings
- Polling intervals

#### 2. `validators.ts` ✅
- `isFiniteNumber`: Number validation
- `isValidNodeKind`: Node kind validation
- `isAgentKind`: Agent type checking

#### 3. `viewport.ts` ✅
- `viewportKeyFor`: Generate viewport keys
- `parseViewportKey`: Parse viewport keys
- Viewport-related types

#### 4. `version-helpers.ts` ✅
- `versionSummaryFromResponse`: Convert version response
- `resolveDraftCandidate`: Find draft versions
- `sortVersionsWithDraftFirst`: Sort versions

#### 5. `helpers.ts` ✅
- `cx`: Conditional className utility

### Phase 3: Extract Services ✅ COMPLETED

Created service modules for business logic:

#### 1. `workflowService.ts` ✅
- `fetchWorkflows()`: Fetch all workflows
- `createWorkflow()`: Create a new workflow
- `deleteWorkflow()`: Delete a workflow
- `deployWorkflow()`: Deploy/promote a version to production
- `renameWorkflow()`: Rename a workflow
- Location: `services/workflowService.ts`

#### 2. `versionService.ts` ✅
- `fetchVersions()`: Fetch all versions for a workflow
- `fetchVersionDetail()`: Fetch specific version details
- `createVersion()`: Create a new version (draft)
- `updateVersion()`: Update an existing version
- `deleteVersion()`: Delete a version
- Location: `services/versionService.ts`

#### 3. `importExportService.ts` ✅
- `exportWorkflow()`: Export workflow version as JSON
- `downloadWorkflowAsFile()`: Download workflow as JSON file
- `importWorkflow()`: Import workflow from JSON payload
- `readFileAsText()`: Read file as text
- Location: `services/importExportService.ts`

### Phase 4: Extract UI Components ✅ COMPLETED

Breaking down the monolithic UI into smaller components:

#### 1. `SaveToast` ✅
- Toast notification for save/deploy status
- Color-coded by state (error, saving, saved)
- Auto-dismisses when message is null
- Location: `components/modals/SaveToast.tsx`

#### 2. `DeployModal` ✅
- Modal for deploying/publishing workflow versions
- Dynamic content based on deployment type
- Production toggle option
- Visual workflow path indicator
- Location: `components/modals/DeployModal.tsx`

#### 3. `PropertiesPanel` ✅
- Wrapper for NodeInspector/EdgeInspector
- Responsive layout (desktop sidebar vs mobile overlay)
- Accessible ARIA labels and roles
- Header with element label and close button
- Location: `components/panels/PropertiesPanel.tsx`

#### 4. `BlockLibraryPanel` ✅
- Panel displaying available node types (blocks)
- Responsive layouts:
  - Mobile: Scrollable list with transform animations
  - Desktop: Collapsible panel with toggle button
- Visual node representation with colors and short labels
- Accessible ARIA labels and roles
- Location: `components/panels/BlockLibraryPanel.tsx`

#### 5. `WorkflowHeader` ✅
- Header component with toolbar and navigation
- Version selector dropdown with draft/production indicators
- Actions menu (import/export/deploy)
- Responsive layouts (desktop buttons vs mobile overflow menu)
- Accessible ARIA labels and roles
- Location: `components/header/WorkflowHeader.tsx`

#### 6. `WorkflowSidebar` ✅
- Sidebar component with workflow list and actions
- Both expanded and collapsed views
- Pinned and regular workflow sections
- Local and hosted workflow support
- Action menus (duplicate, rename, export, customize, delete)
- Pin/unpin functionality with Star icon
- Create workflow button
- Responsive menu placement
- Loading and error states
- Location: `components/sidebar/WorkflowSidebar.tsx`

### Phase 5: Performance Optimization (PLANNED)

#### 1. React.memo (TODO)
- Memoize heavy components
- Prevent unnecessary re-renders

#### 2. Hook Dependencies (TODO)
- Audit useCallback/useMemo dependencies
- Optimize expensive computations

#### 3. useReducer (TODO)
- Consider using useReducer for complex related states
- May improve performance for certain state updates

### Phase 6: Testing (PLANNED)

#### 1. Unit Tests (TODO)
- Test all custom hooks
- Test all services
- Test utility functions

#### 2. Integration Tests (TODO)
- Test complete workflow builder functionality
- Ensure all features work correctly

## File Structure

```
workflow-builder/
├── WorkflowBuilderPage.tsx        # Main component (to be refactored)
├── WorkflowBuilderPage.module.css
├── types.ts
├── utils.ts                        # Existing utils
├── styles.ts
├── REFACTORING.md                  # This file
│
├── hooks/                          # ✅ Custom hooks
│   ├── index.ts
│   ├── useWorkflowState.ts
│   ├── useFlowState.ts
│   ├── useVersionState.ts
│   ├── useSaveState.ts
│   ├── useModalState.ts
│   ├── useResourcesState.ts
│   ├── useViewportState.ts
│   └── useMediaQuery.ts
│
├── utils-internal/                 # ✅ Internal utilities
│   ├── index.ts
│   ├── constants.ts
│   ├── validators.ts
│   ├── viewport.ts
│   ├── version-helpers.ts
│   └── helpers.ts
│
├── services/                       # ✅ Business logic
│   ├── index.ts
│   ├── workflowService.ts
│   ├── versionService.ts
│   └── importExportService.ts
│
└── components/                     # ✅ COMPLETED
    ├── index.ts
    ├── README.md
    ├── header/                     # ✅ COMPLETED
    │   ├── index.ts
    │   └── WorkflowHeader.tsx
    ├── sidebar/                    # ✅ COMPLETED
    │   ├── index.ts
    │   └── WorkflowSidebar.tsx
    ├── panels/                     # ✅ COMPLETED
    │   ├── index.ts
    │   ├── PropertiesPanel.tsx
    │   └── BlockLibraryPanel.tsx
    └── modals/                     # ✅ COMPLETED
        ├── index.ts
        ├── DeployModal.tsx
        └── SaveToast.tsx
```

## Migration Guide

### Using the New Hooks

Instead of managing all state in `WorkflowBuilderPage`, import and use the custom hooks:

```typescript
import {
  useWorkflowState,
  useFlowState,
  useVersionState,
  useSaveState,
  useModalState,
  useResourcesState,
  useViewportState,
  useMediaQuery,
} from "./hooks";

const WorkflowBuilderPage = () => {
  // Workflow state
  const workflowState = useWorkflowState({
    initialCache,
    selectedWorkflowId,
  });

  // Flow state
  const flowState = useFlowState();

  // Version state
  const versionState = useVersionState({
    initialCache,
    initialStoredSelection,
  });

  // Save state
  const saveState = useSaveState({ initialLoading: !initialSidebarCache });

  // Modal state
  const modalState = useModalState();

  // Resources state
  const resourcesState = useResourcesState();

  // Viewport state
  const viewportState = useViewportState();

  // Media query
  const isMobile = useMediaQuery("(max-width: 768px)");

  // ... rest of component logic
};
```

### Using Utilities

Import utilities from the internal utils package:

```typescript
import {
  DESKTOP_MIN_VIEWPORT_ZOOM,
  AUTO_SAVE_DELAY_MS,
  isValidNodeKind,
  isAgentKind,
  viewportKeyFor,
  parseViewportKey,
  versionSummaryFromResponse,
  sortVersionsWithDraftFirst,
  cx,
} from "./utils-internal";
```

### Using Services

Create service instances and use them for API operations:

```typescript
import {
  createWorkflowService,
  createVersionService,
  createImportExportService,
} from "./services";

const WorkflowBuilderPage = () => {
  const { token } = useAuth();
  const authHeader = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  // Create service instances
  const workflowService = useMemo(
    () => createWorkflowService(backendUrl, authHeader),
    [authHeader],
  );

  const versionService = useMemo(
    () => createVersionService(backendUrl, authHeader),
    [authHeader],
  );

  const importExportService = useMemo(
    () => createImportExportService(backendUrl, authHeader),
    [authHeader],
  );

  // Use services in handlers
  const handleCreateWorkflow = async (payload) => {
    try {
      const created = await workflowService.createWorkflow(payload);
      // Handle success...
    } catch (error) {
      // Handle error...
    }
  };

  const handleExportWorkflow = async (workflowId, versionId) => {
    try {
      const graph = await importExportService.exportWorkflow(workflowId, versionId);
      importExportService.downloadWorkflowAsFile(graph, workflowLabel, versionLabel);
      // Handle success...
    } catch (error) {
      // Handle error...
    }
  };

  // ... rest of component
};
```

### Using Components

Import and use extracted UI components:

```typescript
import { SaveToast, DeployModal, PropertiesPanel } from "./components";

const WorkflowBuilderPage = () => {
  // ... state management with hooks

  return (
    <div>
      {/* Main content */}

      {/* Properties panel for selected node/edge */}
      {showPropertiesPanel && (
        <PropertiesPanel
          isMobileLayout={isMobile}
          selectedElementLabel={selectedNode?.data.displayName || ""}
          floatingPanelStyle={floatingPanelStyle}
          onClose={handleClosePropertiesPanel}
          closeButtonRef={propertiesPanelCloseButtonRef}
        >
          {selectedNode ? (
            <NodeInspector node={selectedNode} {...nodeHandlers} />
          ) : selectedEdge ? (
            <EdgeInspector edge={selectedEdge} {...edgeHandlers} />
          ) : null}
        </PropertiesPanel>
      )}

      {/* Toast notifications */}
      <SaveToast
        saveState={saveState}
        saveMessage={saveMessage}
      />

      {/* Deploy modal */}
      <DeployModal
        isOpen={isDeployModalOpen}
        isDeploying={isDeploying}
        deployToProduction={deployToProduction}
        versionSummaryForPromotion={versionSummaryForPromotion}
        isPromotingDraft={isPromotingDraft}
        onClose={handleCloseDeployModal}
        onConfirm={handleConfirmDeploy}
        onProductionToggle={setDeployToProduction}
        t={t}
      />
    </div>
  );
};
```

## Benefits

1. **Improved Maintainability**: Smaller, focused modules are easier to understand and modify
2. **Better Testability**: Isolated hooks and services can be tested independently
3. **Enhanced Performance**: Memoization and optimization opportunities
4. **Code Reusability**: Hooks and utilities can be reused in other components
5. **Clear Separation of Concerns**: Business logic, state management, and UI are separated
6. **Easier Onboarding**: New developers can understand individual pieces without needing to grasp the entire monolith

## Next Steps

1. ✅ Complete Phase 1: Extract Custom Hooks
2. ✅ Complete Phase 2: Extract Utilities
3. ✅ Complete Phase 3: Extract Services
4. TODO: Implement Phase 4: Extract UI Components
5. TODO: Implement Phase 5: Performance Optimization
6. TODO: Implement Phase 6: Testing
7. TODO: Update WorkflowBuilderPage.tsx to use the new structure
8. TODO: Remove duplicated code from WorkflowBuilderPage.tsx
9. TODO: Document all new hooks and utilities
10. TODO: Create migration guide for other similar components

## Notes

- This refactoring should be done incrementally to avoid breaking existing functionality
- Each phase should be tested thoroughly before moving to the next
- The original WorkflowBuilderPage.tsx should remain functional during the refactoring
- Once all phases are complete, the original file should be updated to use the new structure
