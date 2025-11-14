import {
  useEffect,
  useMemo,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";

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
import WorkflowSidebarSection, {
  WorkflowSidebarCompact,
  type WorkflowSidebarSectionEntry,
} from "../../workflows/WorkflowSidebarSection";
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

  const warningStyle = useMemo<CSSProperties>(
    () => ({
      color: "var(--text-muted)",
      fontWeight: 600,
    }),
    [],
  );

  const managedHosted = useMemo(
    () => hostedWorkflows.filter((workflow) => workflow.managed),
    [hostedWorkflows],
  );

  const orderingOptions = useMemo(
    () => (orderingCollator ? { collator: orderingCollator, pinnedLookup } : { pinnedLookup }),
    [orderingCollator, pinnedLookup],
  );

  const orderedEntries = useMemo(
    () =>
      orderWorkflowEntries(
        [
          ...managedHosted.map((hosted) => ({ kind: "hosted" as const, workflow: hosted })),
          ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
        ],
        lastUsedAt,
        orderingOptions,
      ),
    [managedHosted, workflows, lastUsedAt, orderingOptions],
  );

  const sidebarEntries = useMemo<WorkflowSidebarSectionEntry[]>(
    () =>
      orderedEntries.map((entry) => {
        if (entry.kind === "hosted") {
          const hosted = entry.workflow;
          const isPinned = isWorkflowPinned(entry, pinnedLookup);
          const menuKey = `hosted:${hosted.slug}`;
          const isMenuOpen = openWorkflowMenuId === menuKey;
          const menuId = `workflow-actions-${hosted.slug}`;
          const pinLabel = isPinned
            ? t("workflows.unpinAction", { label: hosted.label })
            : t("workflows.pinAction", { label: hosted.label });
          const hostedMenuItems: WorkflowActionMenuItem[] = [
            {
              key: "appearance",
              label: t("workflowBuilder.hostedSection.customizeAction"),
              onSelect: (event) =>
                onOpenAppearanceModal(
                  {
                    kind: "hosted",
                    slug: hosted.slug,
                    label: hosted.label,
                  },
                  event.currentTarget,
                ),
            },
            {
              key: "delete",
              label: t("workflowBuilder.hostedSection.deleteAction"),
              onSelect: () => void onDeleteHostedWorkflow(hosted.slug),
              danger: true,
            },
          ];

          return {
            key: `hosted:${hosted.slug}`,
            kind: "hosted" as const,
            isPinned,
            pinLabel,
            onTogglePin: (event) => {
              event.stopPropagation();
              onToggleHostedPin(hosted.slug);
            },
            menuProps: {
              menuId,
              isOpen: isMenuOpen,
              isMobileLayout,
              placement: isMenuOpen ? workflowMenuPlacement : "down",
              triggerDisabled: hostedLoading,
              triggerLabel: t("workflowBuilder.hostedSection.openActions", {
                label: hosted.label,
              }),
              onOpen: (placement) => {
                setWorkflowMenuPlacement(placement);
                setOpenWorkflowMenuId(menuKey);
              },
              onClose: closeWorkflowMenu,
              triggerRef: workflowMenuTriggerRef,
              menuRef: workflowMenuRef,
              items: hostedMenuItems,
              variant: isMobileLayout ? "overlay" : "default",
            },
            dataAttributes: { "data-hosted-workflow": "" },
            showPinButton: !isMobileLayout,
            content: (
              <button
                type="button"
                className={`chatkit-sidebar__workflow-button chatkit-sidebar__workflow-button--hosted${
                  isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""
                }`}
                aria-disabled="true"
                tabIndex={-1}
                title={hosted.description ?? t("workflows.hostedBadge")}
              >
                <span className="chatkit-sidebar__workflow-label">{hosted.label}</span>
                <span className="chatkit-sidebar__workflow-badge chatkit-sidebar__workflow-badge--hosted">
                  {t("workflows.hostedBadge")}
                </span>
              </button>
            ),
            compact: {
              label: hosted.label,
              initials: getWorkflowInitials(hosted.label),
              disabled: true,
              isActive: false,
              ariaLabel: t("workflows.hostedCompactLabel", { label: hosted.label }),
              hiddenLabelSuffix: t("workflows.hostedBadge"),
            },
          } satisfies WorkflowSidebarSectionEntry;
        }

        const workflow = entry.workflow;
        const isPinned = isWorkflowPinned(entry, pinnedLookup);
        const isActive = workflow.id === selectedWorkflowId;
        const menuId = `workflow-actions-${workflow.id}`;
        const isMenuOpen = openWorkflowMenuId === workflow.id;
        const canDelete = !workflow.is_chatkit_default && !loading;
        const canDuplicate =
          !loading && (workflow.id === selectedWorkflowId || workflow.active_version_id !== null);
        const pinLabel = isPinned
          ? t("workflows.unpinAction", { label: workflow.display_name })
          : t("workflows.pinAction", { label: workflow.display_name });
        const localMenuItems: WorkflowActionMenuItem[] = [
          {
            key: "duplicate",
            label: t("workflowBuilder.localSection.duplicateAction"),
            onSelect: () => void onDuplicateWorkflow(workflow.id),
            disabled: !canDuplicate,
          },
          {
            key: "rename",
            label: t("workflowBuilder.localSection.renameAction"),
            onSelect: () => void onRenameWorkflow(workflow.id),
            disabled: loading,
          },
          {
            key: "export",
            label: t("workflowBuilder.localSection.exportAction"),
            onSelect: () => void onExportWorkflow(workflow.id),
            disabled: loading,
          },
          {
            key: "appearance",
            label: t("workflowBuilder.localSection.customizeAction"),
            onSelect: (event) =>
              onOpenAppearanceModal(
                {
                  kind: "local",
                  workflowId: workflow.id,
                  slug: workflow.slug,
                  label: workflow.display_name,
                },
                event.currentTarget,
              ),
            disabled: loading,
          },
          {
            key: "delete",
            label: t("workflowBuilder.localSection.deleteAction"),
            onSelect: () => void onDeleteWorkflow(workflow.id),
            disabled: !canDelete,
            danger: true,
          },
        ];

        return {
          key: `local:${workflow.id}`,
          kind: "local" as const,
          isPinned,
          pinLabel,
          onTogglePin: (event) => {
            event.stopPropagation();
            onToggleLocalPin(workflow.id);
          },
          menuProps: {
            menuId,
            isOpen: isMenuOpen,
            isMobileLayout,
            placement: isMenuOpen ? workflowMenuPlacement : "down",
            triggerDisabled: loading,
            triggerLabel: t("workflowBuilder.localSection.openActions", {
              label: workflow.display_name,
            }),
            onOpen: (placement) => {
              setWorkflowMenuPlacement(placement);
              setOpenWorkflowMenuId(workflow.id);
            },
            onClose: closeWorkflowMenu,
            triggerRef: workflowMenuTriggerRef,
            menuRef: workflowMenuRef,
            items: localMenuItems,
            variant: isMobileLayout ? "overlay" : "default",
          },
          dataAttributes: {
            "data-local-workflow": "",
            "data-selected": isActive ? "" : undefined,
          },
          showPinButton: !isMobileLayout,
          trailingContent: (
            <>
              {!workflow.is_chatkit_default && !workflow.active_version_id ? (
                <p className="chatkit-sidebar__workflow-meta" aria-live="polite" style={warningStyle}>
                  {t("workflowBuilder.localSection.missingProduction")}
                </p>
              ) : null}
              {workflow.description ? (
                <p className="chatkit-sidebar__workflow-meta">{workflow.description}</p>
              ) : null}
            </>
          ),
          content: (
            <button
              type="button"
              className={`chatkit-sidebar__workflow-button${
                isActive ? " chatkit-sidebar__workflow-button--active" : ""
              }${isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""}`}
              onClick={() => onSelectWorkflow(workflow.id)}
              disabled={loading}
              aria-current={isActive ? "true" : undefined}
              title={workflow.description ?? undefined}
            >
              <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
            </button>
          ),
          compact: {
            label: workflow.display_name,
            initials: getWorkflowInitials(workflow.display_name),
            onClick: () => onSelectWorkflow(workflow.id),
            disabled: loading,
            isActive,
            ariaLabel: workflow.display_name,
          },
        } satisfies WorkflowSidebarSectionEntry;
      }),
    [
      closeWorkflowMenu,
      hostedLoading,
      loading,
      onDeleteHostedWorkflow,
      onDeleteWorkflow,
      onDuplicateWorkflow,
      onExportWorkflow,
      onOpenAppearanceModal,
      onRenameWorkflow,
      onSelectWorkflow,
      onToggleHostedPin,
      onToggleLocalPin,
      openWorkflowMenuId,
      orderedEntries,
      pinnedLookup,
      isMobileLayout,
      workflowMenuPlacement,
      setOpenWorkflowMenuId,
      setWorkflowMenuPlacement,
      t,
      selectedWorkflowId,
      warningStyle,
      workflowMenuRef,
      workflowMenuTriggerRef,
    ],
  );

  const workflowSidebarContent = useMemo(() => {
    const sectionId = "workflow-builder-sidebar";
    const sectionVariant = isMobileLayout ? "overlay" : "default";

    const beforeGroupsContent =
      hostedError || (hostedLoading && managedHosted.length === 0)
        ? (
            <>
              {hostedError ? (
                <p className="chatkit-sidebar__section-error" aria-live="polite">
                  {hostedError}
                </p>
              ) : null}
              {hostedLoading && managedHosted.length === 0 ? (
                <p className="chatkit-sidebar__section-text" aria-live="polite">
                  {t("workflowBuilder.hostedSection.loading")}
                </p>
              ) : null}
            </>
          )
        : undefined;

    const entriesForSection = loadError ? [] : sidebarEntries;

    let emptyContent: ReactNode | undefined;
    if (loadError) {
      emptyContent = (
        <p className="chatkit-sidebar__section-error" aria-live="polite">
          {loadError}
        </p>
      );
    } else if (loading && orderedEntries.length === 0) {
      emptyContent = (
        <p className="chatkit-sidebar__section-text" aria-live="polite">
          Chargement des workflows…
        </p>
      );
    } else if (orderedEntries.length === 0) {
      emptyContent = (
        <p className="chatkit-sidebar__section-text" aria-live="polite">
          Aucun workflow disponible pour le moment.
        </p>
      );
    }

    const footerContent =
      selectedWorkflow?.description || (selectedWorkflow && !selectedWorkflow.active_version_id)
        ? (
            <>
              {selectedWorkflow?.description ? (
                <p className="chatkit-sidebar__section-text">
                  {selectedWorkflow.description}
                </p>
              ) : null}
              {selectedWorkflow && !selectedWorkflow.active_version_id ? (
                <p className="chatkit-sidebar__section-text" style={warningStyle}>
                  Publiez une version pour l'utiliser.
                </p>
              ) : null}
            </>
          )
        : null;

    return (
      <WorkflowSidebarSection
        sectionId={sectionId}
        title={t("workflows.defaultSectionTitle")}
        entries={entriesForSection}
        pinnedSectionTitle={t("workflows.pinnedSectionTitle")}
        defaultSectionTitle={t("workflows.defaultSectionTitle")}
        floatingAction={{
          icon: <span aria-hidden="true">+</span>,
          label: t("workflowBuilder.createWorkflow.openModal"),
          onClick: onOpenCreateModal,
          disabled: isCreatingWorkflow,
        }}
        beforeGroups={beforeGroupsContent}
        emptyState={emptyContent}
        footerContent={footerContent}
        variant={sectionVariant}
      />
    );
  }, [
    hostedError,
    hostedLoading,
    isCreatingWorkflow,
    isMobileLayout,
    loadError,
    loading,
    managedHosted,
    onOpenCreateModal,
    orderedEntries,
    sidebarEntries,
    selectedWorkflow,
    t,
    warningStyle,
  ]);

  const collapsedWorkflowShortcuts = useMemo(() => {
    if (loadError) {
      return null;
    }

    return (
      <WorkflowSidebarCompact
        entries={sidebarEntries}
        pinnedSectionTitle={t("workflows.pinnedSectionTitle")}
        defaultSectionTitle={t("workflows.defaultSectionTitle")}
        isSidebarCollapsed={isSidebarCollapsed}
      />
    );
  }, [isSidebarCollapsed, loadError, sidebarEntries, t]);

  useEffect(() => {
    setSidebarContent(workflowSidebarContent);
    setCollapsedSidebarContent(collapsedWorkflowShortcuts);
    return () => clearSidebarContent();
  }, [
    clearSidebarContent,
    collapsedWorkflowShortcuts,
    setCollapsedSidebarContent,
    setSidebarContent,
    workflowSidebarContent,
  ]);

  return null;
};

export default WorkflowBuilderSidebar;
