# Workflow Builder Components

Extracted UI components from the monolithic `WorkflowBuilderPage.tsx`.

## Directory Structure

```
components/
├── modals/           # Modal dialogs ✅
│   ├── index.ts
│   ├── SaveToast.tsx
│   └── DeployModal.tsx
├── panels/           # Side panels ✅
│   ├── index.ts
│   ├── PropertiesPanel.tsx
│   └── BlockLibraryPanel.tsx
├── header/           # Header components ✅
│   ├── index.ts
│   └── WorkflowHeader.tsx
├── sidebar/          # Sidebar components ✅
│   ├── index.ts
│   └── WorkflowSidebar.tsx
├── index.ts
└── README.md
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

#### BlockLibraryPanel

A panel displaying the available node types (blocks) that can be added to the workflow.

**Props:**
- `isMobileLayout`: `boolean` - Whether to use mobile layout
- `isOpen`: `boolean` - Whether the panel is open (desktop only)
- `items`: `BlockLibraryItem[]` - Array of available blocks
- `loading`: `boolean` - Whether the workflow is loading
- `selectedWorkflowId`: `number | null` - Currently selected workflow
- `onToggle`: `() => void` - Toggle handler (desktop only)
- `toggleRef`: `React.RefObject<HTMLButtonElement>` - Ref for toggle button
- `scrollRef`: `React.RefObject<HTMLDivElement>` - Ref for scroll container (mobile)
- `itemRefs`: `React.MutableRefObject<Record<string, HTMLDivElement | null>>` - Refs for items (mobile)
- `onItemRefSet`: `(key: string, node: HTMLDivElement | null) => void` - Callback when item ref is set
- `contentId`: `string` - ID for content container

**BlockLibraryItem Type:**
```ts
interface BlockLibraryItem {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  onClick: () => void;
}
```

**Features:**
- Responsive layouts:
  - Mobile: Scrollable list with transform animations
  - Desktop: Collapsible panel with toggle button
- Visual node representation with colors and short labels
- Disabled state when workflow is loading or not selected
- Accessible ARIA labels and roles
- Uses existing CSS module styles

**Usage:**
```tsx
<BlockLibraryPanel
  isMobileLayout={isMobile}
  isOpen={isBlockLibraryOpen}
  items={blockLibraryItems}
  loading={loading}
  selectedWorkflowId={selectedWorkflowId}
  onToggle={toggleBlockLibrary}
  toggleRef={blockLibraryToggleRef}
  scrollRef={blockLibraryScrollRef}
  itemRefs={blockLibraryItemRefs}
  onItemRefSet={handleItemRefSet}
  contentId="block-library-content"
/>
```

### Header

#### WorkflowHeader

A header component that displays the workflow toolbar with version selector and action buttons.

**Props:**
- `isMobileLayout`: `boolean` - Whether to use mobile layout
- `loading`: `boolean` - Whether workflow data is loading
- `isImporting`: `boolean` - Whether import is in progress
- `isExporting`: `boolean` - Whether export is in progress
- `isDeploying`: `boolean` - Whether deployment is in progress
- `selectedWorkflowId`: `number | null` - Currently selected workflow ID
- `selectedVersionId`: `number | null` - Currently selected version ID
- `versions`: `WorkflowVersionSummary[]` - Array of available versions
- `selectedWorkflow`: `WorkflowSummary | null` - Currently selected workflow
- `draftVersionIdRef`: `React.MutableRefObject<number | null>` - Ref to draft version ID
- `draftDisplayName`: `string` - Display name for draft versions
- `isMobileActionsOpen`: `boolean` - Whether mobile actions menu is open
- `headerStyle`: `CSSProperties | undefined` - Optional custom header style
- `onOpenSidebar`: `() => void` - Callback to open sidebar navigation
- `onVersionChange`: `(event: ChangeEvent<HTMLSelectElement>) => void` - Version change handler
- `onTriggerImport`: `() => void` - Import file picker trigger handler
- `onImportFileChange`: `(event: ChangeEvent<HTMLInputElement>) => Promise<void>` - Import file handler
- `onExportWorkflow`: `() => Promise<void>` - Export workflow handler
- `onOpenDeployModal`: `() => void` - Open deploy modal handler
- `onToggleMobileActions`: `() => void` - Toggle mobile actions menu
- `onCloseMobileActions`: `() => void` - Close mobile actions menu
- `mobileActionsTriggerRef`: `RefObject<HTMLButtonElement>` - Ref for mobile menu trigger
- `mobileActionsMenuRef`: `RefObject<HTMLDivElement>` - Ref for mobile menu content
- `importFileInputRef`: `RefObject<HTMLInputElement>` - Ref for hidden file input
- `t`: `(key: string) => string` - Translation function

**Features:**
- Responsive layouts:
  - Desktop: Horizontal toolbar with version dropdown and action buttons
  - Mobile: Compact layout with version selector and overflow menu
- Version selector with draft/production indicators
- Import/Export/Deploy actions with disabled states
- Mobile actions menu with workflow description and publication reminder
- Hidden file input for JSON import
- Navigation button to open sidebar
- Accessible ARIA labels and roles
- Uses existing CSS module styles

**Usage:**
```tsx
<WorkflowHeader
  isMobileLayout={isMobile}
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
  onToggleMobileActions={() => setIsMobileActionsOpen((prev) => !prev)}
  onCloseMobileActions={() => setIsMobileActionsOpen(false)}
  mobileActionsTriggerRef={mobileActionsTriggerRef}
  mobileActionsMenuRef={mobileActionsMenuRef}
  importFileInputRef={importFileInputRef}
  t={t}
/>
```

### Sidebar

#### WorkflowSidebar

A sidebar component that displays the workflow list with pinning, searching, and action menus.

**Props:**
- `workflows`: `WorkflowSummary[]` - Array of local workflows
- `hostedWorkflows`: `HostedWorkflowMetadata[]` - Array of hosted workflows
- `selectedWorkflowId`: `number | null` - Currently selected workflow ID
- `selectedWorkflow`: `WorkflowSummary | null` - Currently selected workflow
- `loading`: `boolean` - Whether workflows are loading
- `loadError`: `string | null` - Error message if loading failed
- `hostedLoading`: `boolean` - Whether hosted workflows are loading
- `hostedError`: `string | null` - Error message if hosted loading failed
- `isCreatingWorkflow`: `boolean` - Whether workflow creation is in progress
- `isMobileLayout`: `boolean` - Whether to use mobile layout
- `isSidebarCollapsed`: `boolean` - Whether sidebar is collapsed
- `pinnedLookup`: `StoredWorkflowPinnedLookup` - Map of pinned workflows
- `lastUsedAt`: `StoredWorkflowLastUsedAt` - Map of last used timestamps
- `openWorkflowMenuId`: `number | string | null` - ID of currently open workflow menu
- `workflowMenuPlacement`: `"up" | "down"` - Placement of workflow action menu
- `onSelectWorkflow`: `(workflowId: number) => void` - Select workflow handler
- `onOpenCreateModal`: `() => void` - Open create workflow modal handler
- `onDuplicateWorkflow`: `(workflowId: number) => Promise<void>` - Duplicate workflow handler
- `onRenameWorkflow`: `(workflowId: number) => Promise<void>` - Rename workflow handler
- `onExportWorkflow`: `(workflowId: number) => Promise<void>` - Export workflow handler
- `onDeleteWorkflow`: `(workflowId: number) => Promise<void>` - Delete workflow handler
- `onDeleteHostedWorkflow`: `(slug: string) => Promise<void>` - Delete hosted workflow handler
- `onToggleLocalPin`: `(workflowId: number) => void` - Toggle local workflow pin
- `onToggleHostedPin`: `(slug: string) => void` - Toggle hosted workflow pin
- `onCloseWorkflowMenu`: `() => void` - Close workflow menu handler
- `onSetOpenWorkflowMenuId`: `(id: number | string | null) => void` - Set open menu ID
- `onSetWorkflowMenuPlacement`: `(placement: "up" | "down") => void` - Set menu placement
- `onOpenAppearanceModal`: `(target, triggerElement) => void` - Open appearance modal handler
- `t`: `(key: string, params?: Record<string, unknown>) => string` - Translation function

**Returns:**
- `{ expandedContent: ReactNode, collapsedContent: ReactNode | null }` - Sidebar content for expanded and collapsed states

**Features:**
- Workflow list with pinned and regular sections
- Both local and hosted workflow support
- Pin/unpin functionality with Star icon
- Action menus for each workflow (duplicate, rename, export, customize, delete)
- Responsive menu placement (up/down based on available space)
- Loading and error states
- Create workflow button
- Workflow description and publication reminder
- Collapsed view with workflow initials
- Accessible ARIA labels and semantic HTML
- Uses existing chatkit-sidebar CSS classes

**Usage:**
```tsx
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
  onExportWorkflow: handleExportWorkflow,
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

// Use with sidebar portal
useEffect(() => {
  setSidebarContent(expandedContent);
  setCollapsedSidebarContent(collapsedContent);
  return () => clearSidebarContent();
}, [expandedContent, collapsedContent]);
```

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
2. ✅ Extract BlockLibraryPanel component
3. ✅ Extract WorkflowHeader component
4. ✅ Extract WorkflowSidebar component
5. Add unit tests for all components
6. Update WorkflowBuilderPage to use extracted components
