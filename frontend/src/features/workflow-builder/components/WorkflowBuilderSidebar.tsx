import { useEffect, useMemo, type CSSProperties, type MutableRefObject } from "react";

import { Star } from "lucide-react";

import { useSidebarPortal } from "../../../components/AppLayout";
import { useI18n } from "../../../i18n";
import type { HostedWorkflowMetadata } from "../../../utils/backend";
import {
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinnedLookup,
} from "../../workflows/utils";
import type { WorkflowAppearanceTarget } from "../../workflows/WorkflowAppearanceModal";
import type { WorkflowSummary } from "../types";
import WorkflowActionMenu, {
  type ActionMenuPlacement,
  type WorkflowActionMenuItem,
} from "../../workflows/WorkflowActionMenu";

export type WorkflowBuilderSidebarProps = {
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  loading: boolean;
  loadError: string | null;
  hostedLoading: boolean;
  hostedError: string | null;
  isCreatingWorkflow: boolean;
  selectedWorkflow: WorkflowSummary | null;
  selectedWorkflowId: number | null;
  openWorkflowMenuId: string | number | null;
  workflowMenuPlacement: ActionMenuPlacement;
  isMobileLayout: boolean;
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
  closeWorkflowMenu: () => void;
  workflowMenuTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  workflowMenuRef: MutableRefObject<HTMLDivElement | null>;
  setWorkflowMenuPlacement: (placement: ActionMenuPlacement) => void;
  setOpenWorkflowMenuId: (value: string | number | null) => void;
};

const WorkflowBuilderSidebar = ({
  workflows,
  hostedWorkflows,
  lastUsedAt,
  pinnedLookup,
  loading,
  loadError,
  hostedLoading,
  hostedError,
  isCreatingWorkflow,
  selectedWorkflow,
  selectedWorkflowId,
  openWorkflowMenuId,
  workflowMenuPlacement,
  isMobileLayout,
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
  closeWorkflowMenu,
  workflowMenuTriggerRef,
  workflowMenuRef,
  setWorkflowMenuPlacement,
  setOpenWorkflowMenuId,
}: WorkflowBuilderSidebarProps) => {
  const { t } = useI18n();
  const { setSidebarContent, setCollapsedSidebarContent, clearSidebarContent } =
    useSidebarPortal();

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
    const sectionId = "workflow-builder-sidebar";
    const warningStyle: CSSProperties = {
      color: "var(--text-muted)",
      fontWeight: 600,
    };
    const managedHosted = hostedWorkflows.filter((workflow) => workflow.managed);

    type CombinedEntry =
      | { kind: "hosted"; hosted: HostedWorkflowMetadata; isPinned: boolean }
      | { kind: "local"; workflow: WorkflowSummary; isPinned: boolean };

    const orderingOptions = orderingCollator
      ? { collator: orderingCollator, pinnedLookup }
      : { pinnedLookup };

    const combinedEntries: CombinedEntry[] = orderWorkflowEntries(
      [
        ...managedHosted.map((hosted) => ({ kind: "hosted" as const, workflow: hosted })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      orderingOptions,
    ).map((entry) =>
      entry.kind === "hosted"
        ? ({
            kind: "hosted" as const,
            hosted: entry.workflow,
            isPinned: isWorkflowPinned(entry, pinnedLookup),
          } satisfies CombinedEntry)
        : ({
            kind: "local" as const,
            workflow: entry.workflow,
            isPinned: isWorkflowPinned(entry, pinnedLookup),
          } satisfies CombinedEntry),
    );

    const pinnedEntries: CombinedEntry[] = [];
    const regularEntries: CombinedEntry[] = [];

    for (const entry of combinedEntries) {
      if (entry.isPinned) {
        pinnedEntries.push(entry);
      } else {
        regularEntries.push(entry);
      }
    }

    const renderWorkflowList = () => {
      if (loading && combinedEntries.length === 0) {
        return (
          <p className="chatkit-sidebar__section-text" aria-live="polite">
            Chargement des workflows…
          </p>
        );
      }

      if (loadError) {
        return (
          <p className="chatkit-sidebar__section-error" aria-live="polite">
            {loadError}
          </p>
        );
      }

      if (combinedEntries.length === 0) {
        return (
          <p className="chatkit-sidebar__section-text" aria-live="polite">
            Aucun workflow disponible pour le moment.
          </p>
        );
      }

      const renderEntry = (entry: CombinedEntry) => {
        if (entry.kind === "hosted") {
          const { hosted, isPinned } = entry;
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

          return (
            <li
              key={`hosted:${hosted.slug}`}
              className="chatkit-sidebar__workflow-list-item chatkit-sidebar__workflow-list-item--with-pin"
              data-hosted-workflow=""
              data-pinned={isPinned ? "" : undefined}
              data-has-actions=""
            >
              <button
                type="button"
                className="chatkit-sidebar__workflow-action-button chatkit-sidebar__workflow-pin-button chatkit-sidebar__workflow-pin-button--leading"
                aria-pressed={isPinned}
                aria-label={pinLabel}
                title={pinLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleHostedPin(hosted.slug);
                }}
              >
                <Star
                  aria-hidden="true"
                  className="chatkit-sidebar__workflow-pin-icon"
                  size={18}
                  strokeWidth={isPinned ? 1.75 : 2}
                  fill={isPinned ? "currentColor" : "none"}
                />
              </button>
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
              <WorkflowActionMenu
                menuId={menuId}
                isOpen={isMenuOpen}
                isMobileLayout={isMobileLayout}
                placement={isMenuOpen ? workflowMenuPlacement : "down"}
                triggerDisabled={hostedLoading}
                triggerLabel={t("workflowBuilder.hostedSection.openActions", { label: hosted.label })}
                onOpen={(placement) => {
                  setWorkflowMenuPlacement(placement);
                  setOpenWorkflowMenuId(menuKey);
                }}
                onClose={closeWorkflowMenu}
                triggerRef={workflowMenuTriggerRef}
                menuRef={workflowMenuRef}
                items={hostedMenuItems}
              />
            </li>
          );
        }

        const { workflow, isPinned } = entry;
        const isActive = workflow.id === selectedWorkflowId;
        const menuId = `workflow-actions-${workflow.id}`;
        const isMenuOpen = openWorkflowMenuId === workflow.id;
        const canDelete = !workflow.is_chatkit_default && !loading;
        const canDuplicate = Boolean(selectedWorkflowId === workflow.id && !loading);
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

        return (
          <li
            key={`local:${workflow.id}`}
            className="chatkit-sidebar__workflow-list-item chatkit-sidebar__workflow-list-item--with-pin"
            data-local-workflow=""
            data-selected={isActive ? "" : undefined}
            data-pinned={isPinned ? "" : undefined}
            data-has-actions=""
          >
            <button
              type="button"
              className="chatkit-sidebar__workflow-action-button chatkit-sidebar__workflow-pin-button chatkit-sidebar__workflow-pin-button--leading"
              aria-pressed={isPinned}
              aria-label={pinLabel}
              title={pinLabel}
              onClick={(event) => {
                event.stopPropagation();
                onToggleLocalPin(workflow.id);
              }}
            >
              <Star
                aria-hidden="true"
                className="chatkit-sidebar__workflow-pin-icon"
                size={18}
                strokeWidth={isPinned ? 1.75 : 2}
                fill={isPinned ? "currentColor" : "none"}
              />
            </button>
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
              <span className="chatkit-sidebar__workflow-label">
                {workflow.display_name}
              </span>
            </button>
            <WorkflowActionMenu
              menuId={menuId}
              isOpen={isMenuOpen}
              isMobileLayout={isMobileLayout}
              placement={isMenuOpen ? workflowMenuPlacement : "down"}
              triggerDisabled={loading}
              triggerLabel={t("workflowBuilder.localSection.openActions", {
                label: workflow.display_name,
              })}
              onOpen={(placement) => {
                setWorkflowMenuPlacement(placement);
                setOpenWorkflowMenuId(workflow.id);
              }}
              onClose={closeWorkflowMenu}
              triggerRef={workflowMenuTriggerRef}
              menuRef={workflowMenuRef}
              items={localMenuItems}
            />
            {!workflow.is_chatkit_default && !workflow.active_version_id ? (
              <p className="chatkit-sidebar__workflow-meta" aria-live="polite" style={warningStyle}>
                {t("workflowBuilder.localSection.missingProduction")}
              </p>
            ) : null}
            {workflow.description ? (
              <p className="chatkit-sidebar__workflow-meta">{workflow.description}</p>
            ) : null}
          </li>
        );
      };

      return (
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
          {!hostedLoading && !hostedError && managedHosted.length === 0 ? (
            <p className="chatkit-sidebar__section-text" aria-live="polite">
              {t("workflowBuilder.hostedSection.empty")}
            </p>
          ) : null}
          {pinnedEntries.length > 0 ? (
            <div
              className="chatkit-sidebar__workflow-group chatkit-sidebar__workflow-group--pinned"
              data-workflow-group="pinned"
            >
              <h3 className="chatkit-sidebar__workflow-group-title">
                {t("workflows.pinnedSectionTitle")}
              </h3>
              <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
                {pinnedEntries.map((entry) => renderEntry(entry))}
              </ul>
            </div>
          ) : null}
          {regularEntries.length > 0 ? (
            <div className="chatkit-sidebar__workflow-group" data-workflow-group="default">
              <h3 className="chatkit-sidebar__workflow-group-title">
                {t("workflows.defaultSectionTitle")}
              </h3>
              <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
                {regularEntries.map((entry) => renderEntry(entry))}
              </ul>
            </div>
          ) : null}
        </>
      );
    };

    return (
      <section
        className="chatkit-sidebar__section chatkit-sidebar__section--with-floating-action"
        aria-labelledby={`${sectionId}-title`}
      >
        <h2 id={`${sectionId}-title`} className="visually-hidden">
          {t("workflows.defaultSectionTitle")}
        </h2>
        <div className="chatkit-sidebar__section-floating-action">
          <button
            type="button"
            className="chatkit-sidebar__section-icon-button"
            onClick={onOpenCreateModal}
            aria-label={t("workflowBuilder.createWorkflow.openModal")}
            title={t("workflowBuilder.createWorkflow.openModal")}
            disabled={isCreatingWorkflow}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
        {renderWorkflowList()}
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
      </section>
    );
  }, [
    closeWorkflowMenu,
    hostedError,
    hostedLoading,
    hostedWorkflows,
    isCreatingWorkflow,
    isMobileLayout,
    lastUsedAt,
    loadError,
    loading,
    onDeleteHostedWorkflow,
    onDeleteWorkflow,
    onDuplicateWorkflow,
    onExportWorkflow,
    onOpenAppearanceModal,
    onOpenCreateModal,
    onRenameWorkflow,
    onSelectWorkflow,
    onToggleHostedPin,
    onToggleLocalPin,
    openWorkflowMenuId,
    orderingCollator,
    pinnedLookup,
    selectedWorkflow,
    selectedWorkflowId,
    setOpenWorkflowMenuId,
    setWorkflowMenuPlacement,
    t,
    workflowMenuPlacement,
    workflowMenuRef,
    workflowMenuTriggerRef,
    workflows,
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
