import {
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";

import { useSidebarPortal } from "../../../components/AppLayout";
import { useI18n } from "../../../i18n";
import type { HostedWorkflowMetadata } from "../../../utils/backend";
import type { WorkflowSummary } from "../../../types/workflows";
import {
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinnedLookup,
} from "../../workflows/utils";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";
import type {
  ActionMenuPlacement,
  WorkflowActionMenuItem,
} from "../../workflows/WorkflowActionMenu";
import WorkflowSidebarSection, {
  WorkflowSidebarCompact,
} from "../../workflows/WorkflowSidebarSection";
import { useWorkflowContext } from "../contexts/WorkflowContext";
import { useModalContext } from "../contexts/ModalContext";
import { useUIContext } from "../contexts/UIContext";
import { useWorkflowSidebarEntries } from "../../workflows/hooks/useWorkflowSidebarEntries";

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

  const hostedMenuItems = useCallback(
    ({ hosted, t }: {
      hosted: HostedWorkflowMetadata;
      t: ReturnType<typeof useI18n>["t"];
    }): WorkflowActionMenuItem[] => [
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
    ],
    [onDeleteHostedWorkflow, onOpenAppearanceModal],
  );

  const localMenuItems = useCallback(
    ({ workflow, t }: {
      workflow: WorkflowSummary;
      t: ReturnType<typeof useI18n>["t"];
    }): WorkflowActionMenuItem[] => {
      const canDelete = !workflow.is_chatkit_default && !loading;
      const canDuplicate =
        !loading && (workflow.id === selectedWorkflowId || workflow.active_version_id !== null);

      return [
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
    },
    [
      loading,
      onDeleteWorkflow,
      onDuplicateWorkflow,
      onExportWorkflow,
      onOpenAppearanceModal,
      onRenameWorkflow,
      selectedWorkflowId,
    ],
  );

  const localTrailingContent = useCallback(
    (workflow: WorkflowSummary) => (
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
    [t, warningStyle],
  );

  const sidebarEntries = useWorkflowSidebarEntries({
    workflows,
    hostedWorkflows: managedHosted,
    lastUsedAt,
    pinnedLookup,
    workflowCollator: orderingCollator,
    isMobileLayout,
    selectedWorkflowId,
    loading,
    hostedLoading,
    callbacks: {
      onLocalClick: onSelectWorkflow,
      onToggleHostedPin,
      onToggleLocalPin,
    },
    menuConfig: {
      openWorkflowMenuId,
      workflowMenuPlacement,
      workflowMenuTriggerRef,
      workflowMenuRef,
      onOpenMenu: (id, placement) => {
        setWorkflowMenuPlacement(placement);
        setOpenWorkflowMenuId(id);
      },
      onCloseMenu: closeWorkflowMenu,
    },
    hostedMenuItems,
    localMenuItems,
    localTrailingContent,
  });

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
    } else if (loading && sidebarEntries.length === 0) {
      emptyContent = (
        <p className="chatkit-sidebar__section-text" aria-live="polite">
          Chargement des workflows…
        </p>
      );
    } else if (sidebarEntries.length === 0) {
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
