import { useEffect, useMemo, type MutableRefObject } from "react";

import { useSidebarPortal } from "../../../components/AppLayout";
import { useI18n } from "../../../i18n";
import {
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinnedLookup,
} from "../../workflows/utils";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";
import type {
  ActionMenuPlacement,
} from "../../workflows/WorkflowActionMenu";
import { WorkflowList } from "../../workflows/WorkflowList";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useModalContext } from "../contexts/ModalContext";
import { useUIContext } from "../contexts/UIContext";

// Phase 4.5: Reduced from 28 props to 13 props (-54%)
// Migrated to contexts:
// - workflows, hostedWorkflows → WorkflowContext
// - loading, loadError, hostedLoading, hostedError → WorkflowContext
// - selectedWorkflowId → WorkflowContext
// - selectedWorkflow → Derived from WorkflowContext (workflows + selectedWorkflowId)
// - isCreatingWorkflow → ModalContext
// - openWorkflowMenuId, isMobileLayout → UIContext
// - closeWorkflowMenu, setOpenWorkflowMenuId → UIContext
export type WorkflowBuilderSidebarProps = {
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  workflowMenuPlacement: ActionMenuPlacement;
  isSidebarCollapsed: boolean;
  workflowSortCollator: Intl.Collator | null;
  onSelectWorkflow: (workflowId: number) => void;
  onRenameWorkflow: (workflowId: number) => void;
  onDeleteWorkflow: (workflowId: number) => void | Promise<void>;
  onDuplicateWorkflow: (workflowId?: number) => void | Promise<void>;
  onDeleteHostedWorkflow: (slug: string) => void | Promise<void>;
  onToggleLocalPin: (workflowId: number) => void;
  onToggleHostedPin: (slug: string) => void;
  onOpenCreateModal: () => void;
  onOpenAppearanceModal: (
    target: WorkflowAppearanceTarget,
    trigger?: HTMLButtonElement | null,
  ) => void;
  onExportWorkflow: (workflowId?: number) => void | Promise<void>;
  workflowMenuTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  workflowMenuRef: MutableRefObject<HTMLDivElement | null>;
  setWorkflowMenuPlacement: (placement: ActionMenuPlacement) => void;
};

const WorkflowBuilderSidebar = ({
  lastUsedAt,
  pinnedLookup,
  workflowMenuPlacement,
  isSidebarCollapsed,
  workflowSortCollator,
  onSelectWorkflow,
  onRenameWorkflow,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onDeleteHostedWorkflow,
  onToggleLocalPin,
  onToggleHostedPin,
  onOpenCreateModal,
  onOpenAppearanceModal,
  onExportWorkflow,
  workflowMenuTriggerRef,
  workflowMenuRef,
  setWorkflowMenuPlacement,
}: WorkflowBuilderSidebarProps) => {
  const { t } = useI18n();
  const { setSidebarContent, setCollapsedSidebarContent, clearSidebarContent } =
    useSidebarPortal();

  // Phase 4.5: Use contexts instead of props
  const {
    workflows,
    hostedWorkflows,
    loading,
    loadError,
    hostedLoading,
    hostedError,
    selectedWorkflowId,
  } = useWorkflowContext();

  const { isCreatingWorkflow } = useModalContext();

  const {
    openWorkflowMenuId,
    isMobileLayout,
    closeWorkflowMenu,
    setOpenWorkflowMenuId,
  } = useUIContext();

  // Phase 4.5: Derive selectedWorkflow from context data
  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) || null,
    [workflows, selectedWorkflowId]
  );

  const orderingCollator = useMemo(() => {
    if (workflowSortCollator) {
      return workflowSortCollator;
    }
    if (typeof Intl !== "undefined" && typeof Intl.Collator === "function") {
      return new Intl.Collator(undefined, { sensitivity: "base" });
    }
    return null;
  }, [workflowSortCollator]);

  const workflowSidebarContent = useMemo(() => {
    return (
      <WorkflowList
        workflows={workflows}
        hostedWorkflows={hostedWorkflows}
        lastUsedAt={lastUsedAt}
        pinnedLookup={pinnedLookup}
        loading={loading}
        loadError={loadError}
        hostedLoading={hostedLoading}
        hostedError={hostedError}
        selectedWorkflowId={selectedWorkflowId}
        openWorkflowMenuId={openWorkflowMenuId}
        workflowMenuPlacement={workflowMenuPlacement}
        setOpenWorkflowMenuId={setOpenWorkflowMenuId}
        setWorkflowMenuPlacement={setWorkflowMenuPlacement}
        closeWorkflowMenu={closeWorkflowMenu}
        workflowMenuTriggerRef={workflowMenuTriggerRef}
        workflowMenuRef={workflowMenuRef}
        onSelectLocalWorkflow={onSelectWorkflow}
        onRenameWorkflow={onRenameWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
        onDuplicateWorkflow={onDuplicateWorkflow}
        onExportWorkflow={onExportWorkflow}
        onDeleteHostedWorkflow={onDeleteHostedWorkflow}
        onOpenAppearanceModal={onOpenAppearanceModal}
        onToggleLocalPin={onToggleLocalPin}
        onToggleHostedPin={onToggleHostedPin}
        isMobileLayout={isMobileLayout}
        variant="builder"
        workflowSortCollator={workflowSortCollator}
        showCreateButton={true}
        onOpenCreateModal={onOpenCreateModal}
        isCreatingWorkflow={isCreatingWorkflow}
        selectedWorkflowDescription={selectedWorkflow?.description}
        showProductionWarning={Boolean(
          selectedWorkflow && !selectedWorkflow.active_version_id
        )}
      />
    );
  }, [
    workflows,
    hostedWorkflows,
    lastUsedAt,
    pinnedLookup,
    loading,
    loadError,
    hostedLoading,
    hostedError,
    selectedWorkflowId,
    openWorkflowMenuId,
    workflowMenuPlacement,
    setOpenWorkflowMenuId,
    setWorkflowMenuPlacement,
    closeWorkflowMenu,
    workflowMenuTriggerRef,
    workflowMenuRef,
    onSelectWorkflow,
    onRenameWorkflow,
    onDeleteWorkflow,
    onDuplicateWorkflow,
    onExportWorkflow,
    onDeleteHostedWorkflow,
    onOpenAppearanceModal,
    onToggleLocalPin,
    onToggleHostedPin,
    isMobileLayout,
    workflowSortCollator,
    onOpenCreateModal,
    isCreatingWorkflow,
    selectedWorkflow,
  ]);


  const collapsedWorkflowShortcuts = useMemo(() => {
    if (loadError) {
      return null;
    }

    const managedHosted = hostedWorkflows.filter((workflow) => workflow.managed);
    const orderingOptions = orderingCollator
      ? { collator: orderingCollator, pinnedLookup }
      : { pinnedLookup };

    const orderedEntries = orderWorkflowEntries(
      [
        ...managedHosted.map((workflow) => ({ kind: "hosted" as const, workflow })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      orderingOptions,
    );

    type ShortcutEntry = {
      key: string;
      label: string;
      onClick: (() => void) | undefined;
      disabled: boolean;
      isActive: boolean;
      initials: string;
      kind: "hosted" | "local";
      isPinned: boolean;
    };

    const entries: ShortcutEntry[] = orderedEntries.map((entry) => {
      if (entry.kind === "hosted") {
        const workflow = entry.workflow;
        return {
          key: `hosted:${workflow.slug}`,
          label: workflow.label,
          onClick: undefined,
          disabled: true,
          isActive: false,
          initials: getWorkflowInitials(workflow.label),
          kind: "hosted" as const,
          isPinned: isWorkflowPinned(entry, pinnedLookup),
        } satisfies ShortcutEntry;
      }

      const workflow = entry.workflow;
      return {
        key: `local:${workflow.id}`,
        label: workflow.display_name,
        onClick: () => onSelectWorkflow(workflow.id),
        disabled: loading,
        isActive: workflow.id === selectedWorkflowId,
        initials: getWorkflowInitials(workflow.display_name),
        kind: "local" as const,
        isPinned: isWorkflowPinned(entry, pinnedLookup),
      } satisfies ShortcutEntry;
    });

    if (entries.length === 0) {
      return null;
    }

    const pinnedEntries: ShortcutEntry[] = [];
    const regularEntries: ShortcutEntry[] = [];

    for (const entry of entries) {
      if (entry.isPinned) {
        pinnedEntries.push(entry);
      } else {
        regularEntries.push(entry);
      }
    }

    const renderShortcut = (workflow: ShortcutEntry) => (
      <li
        key={workflow.key}
        className="chatkit-sidebar__workflow-compact-item"
        data-pinned={workflow.isPinned ? "" : undefined}
      >
        <button
          type="button"
          className={`chatkit-sidebar__workflow-compact-button${
            workflow.isActive ? " chatkit-sidebar__workflow-compact-button--active" : ""
          }${workflow.kind === "hosted" ? " chatkit-sidebar__workflow-compact-button--hosted" : ""}${
            workflow.isPinned ? " chatkit-sidebar__workflow-compact-button--pinned" : ""
          }`}
          onClick={workflow.onClick}
          disabled={workflow.disabled}
          aria-current={workflow.isActive ? "true" : undefined}
          title={workflow.label}
          tabIndex={isSidebarCollapsed ? 0 : -1}
          aria-label={
            workflow.kind === "hosted"
              ? t("workflows.hostedCompactLabel", { label: workflow.label })
              : workflow.label
          }
        >
          <span aria-hidden="true" className="chatkit-sidebar__workflow-compact-initial">
            {workflow.initials}
          </span>
          <span className="visually-hidden">
            {workflow.label}
            {workflow.kind === "hosted" ? ` (${t("workflows.hostedBadge")})` : ""}
          </span>
        </button>
      </li>
    );

    return (
      <div className="chatkit-sidebar__workflow-compact-groups">
        {pinnedEntries.length > 0 ? (
          <div
            className="chatkit-sidebar__workflow-compact-group chatkit-sidebar__workflow-compact-group--pinned"
            data-workflow-group="pinned"
          >
            <h3 className="chatkit-sidebar__workflow-compact-group-title">
              {t("workflows.pinnedSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-compact-list chatkit-sidebar__workflow-compact-list--grouped">
              {pinnedEntries.map((workflow) => renderShortcut(workflow))}
            </ul>
          </div>
        ) : null}
        {regularEntries.length > 0 ? (
          <div className="chatkit-sidebar__workflow-compact-group" data-workflow-group="default">
            <h3 className="chatkit-sidebar__workflow-compact-group-title">
              {t("workflows.defaultSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-compact-list">
              {regularEntries.map((workflow) => renderShortcut(workflow))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }, [
    hostedWorkflows,
    isSidebarCollapsed,
    lastUsedAt,
    loadError,
    loading,
    onSelectWorkflow,
    orderingCollator,
    pinnedLookup,
    selectedWorkflowId,
    t,
    workflows,
  ]);

  useEffect(() => {
    setSidebarContent(workflowSidebarContent);
    setCollapsedSidebarContent(collapsedWorkflowShortcuts);
  }, [
    collapsedWorkflowShortcuts,
    setCollapsedSidebarContent,
    setSidebarContent,
    workflowSidebarContent,
  ]);

  return null;
};

export default WorkflowBuilderSidebar;
