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

### Phase 3: Extract Services (PLANNED)

Create service modules for business logic:

#### 1. `workflowService.ts` (TODO)
- Create workflow
- Update workflow
- Delete workflow
- Deploy workflow

#### 2. `versionService.ts` (TODO)
- Fetch versions
- Publish version
- Create draft
- Load version details

#### 3. `importExportService.ts` (TODO)
- Import workflow from JSON
- Export workflow to JSON
- Validation logic

#### 4. `flowOperationsService.ts` (TODO)
- Add node
- Delete node
- Connect nodes
- Disconnect edges

### Phase 4: Extract UI Components (PLANNED)

Break down the monolithic UI into smaller components:

#### 1. `WorkflowHeader` (TODO)
- Toolbar
- Actions menu
- Version selector
- Deploy button

#### 2. `WorkflowSidebar` (TODO)
- Workflow list
- Search
- Pinning interface
- Create workflow button

#### 3. `BlockLibraryPanel` (TODO)
- Node types palette
- Drag and drop interface

#### 4. `PropertiesPanel` (TODO)
- Wrapper for NodeInspector/EdgeInspector
- Responsive behavior

#### 5. `DeployModal` (TODO)
- Extract inline modal JSX
- Deployment configuration

#### 6. `SaveToast` (TODO)
- Save status notifications

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
├── services/                       # TODO: Business logic
│   ├── workflowService.ts
│   ├── versionService.ts
│   ├── importExportService.ts
│   └── flowOperationsService.ts
│
└── components/                     # TODO: UI components
    ├── header/
    │   └── WorkflowHeader.tsx
    ├── sidebar/
    │   └── WorkflowSidebar.tsx
    ├── panels/
    │   ├── BlockLibraryPanel.tsx
    │   └── PropertiesPanel.tsx
    └── modals/
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
3. TODO: Implement Phase 3: Extract Services
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
