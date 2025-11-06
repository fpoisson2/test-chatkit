# Workflow Builder Components

Extracted UI components from the monolithic `WorkflowBuilderPage.tsx`.

## Directory Structure

```
components/
├── modals/           # Modal dialogs
│   ├── SaveToast.tsx
│   └── DeployModal.tsx
├── panels/           # Side panels (TODO)
├── header/           # Header components (TODO)
├── sidebar/          # Sidebar components (TODO)
└── index.ts
```

## Components

### Modals

#### SaveToast

A toast notification component that displays save/deploy status messages.

**Props:**
- `saveState`: `SaveState` - Current save state ("idle" | "saving" | "saved" | "error")
- `saveMessage`: `string | null` - Message to display

**Features:**
- Automatic color coding based on state
- Error (red), Saving (blue), Saved (green)
- Positioned at bottom center
- Auto-dismisses when saveMessage is null

**Usage:**
```tsx
<SaveToast
  saveState={saveState}
  saveMessage={saveMessage}
/>
```

#### DeployModal

A modal dialog for deploying/publishing workflow versions.

**Props:**
- `isOpen`: `boolean` - Whether modal is visible
- `isDeploying`: `boolean` - Whether deployment is in progress
- `deployToProduction`: `boolean` - Production toggle state
- `versionSummaryForPromotion`: `WorkflowVersionSummary | null` - Version to promote
- `isPromotingDraft`: `boolean` - Whether promoting draft version
- `onClose`: `() => void` - Close handler
- `onConfirm`: `() => void` - Confirm deployment handler
- `onProductionToggle`: `(checked: boolean) => void` - Production toggle handler
- `t`: Translation function

**Features:**
- Dynamic title and description based on deployment type
- Visual workflow path indicator (source → target)
- Production deployment toggle
- Disabled state during deployment
- Localized text via translation function

**Usage:**
```tsx
<DeployModal
  isOpen={isDeployModalOpen}
  isDeploying={isDeploying}
  deployToProduction={deployToProduction}
  versionSummaryForPromotion={versionSummary}
  isPromotingDraft={isDraft}
  onClose={handleClose}
  onConfirm={handleConfirm}
  onProductionToggle={setDeployToProduction}
  t={t}
/>
```

### Panels

#### PropertiesPanel

A wrapper component for displaying node and edge properties with responsive behavior.

**Props:**
- `isMobileLayout`: `boolean` - Whether to use mobile layout
- `selectedElementLabel`: `string` - Label for the selected element (node/edge)
- `floatingPanelStyle`: `CSSProperties | undefined` - Style for desktop floating panel
- `onClose`: `() => void` - Close panel handler
- `closeButtonRef`: `React.RefObject<HTMLButtonElement>` - Ref for close button
- `children`: `ReactNode` - Content to display (NodeInspector or EdgeInspector)

**Features:**
- Responsive layout (desktop sidebar vs mobile overlay)
- Accessible ARIA labels and roles
- Header with element label and close button
- Scrollable body for inspector content
- Uses existing CSS module styles

**Usage:**
```tsx
<PropertiesPanel
  isMobileLayout={isMobile}
  selectedElementLabel={selectedNode?.data.displayName || ""}
  floatingPanelStyle={floatingPanelStyle}
  onClose={handleClosePropertiesPanel}
  closeButtonRef={propertiesPanelCloseButtonRef}
>
  {selectedNode ? (
    <NodeInspector node={selectedNode} {...handlers} />
  ) : selectedEdge ? (
    <EdgeInspector edge={selectedEdge} {...handlers} />
  ) : null}
</PropertiesPanel>
```

## Future Components (Planned)

### Panels
- **BlockLibraryPanel**: Node types palette with drag and drop

### Header
- **WorkflowHeader**: Toolbar, actions menu, version selector, deploy button

### Sidebar
- **WorkflowSidebar**: Workflow list, search, pinning interface, create button

## Benefits

- **Reusability**: Components can be used in other parts of the application
- **Testability**: Isolated components are easier to unit test
- **Maintainability**: Smaller, focused components are easier to understand and modify
- **Type Safety**: Full TypeScript support with proper prop types
- **Separation of Concerns**: UI logic separated from business logic

## Migration Notes

When using these extracted components in `WorkflowBuilderPage.tsx`:

1. Import from the components directory:
```tsx
import { SaveToast, DeployModal } from "./components";
```

2. Replace inline JSX with component usage
3. Pass required props from parent component state
4. Maintain existing behavior and styling

## Next Steps

1. ✅ Extract PropertiesPanel component
2. Extract BlockLibraryPanel component
3. Extract WorkflowHeader component
4. Extract WorkflowSidebar component
5. Add unit tests for all components
6. Update WorkflowBuilderPage to use extracted components
