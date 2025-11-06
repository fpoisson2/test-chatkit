import { useMemo, type CSSProperties } from "react";
import { Star } from "lucide-react";
import type {
  WorkflowSummary,
  HostedWorkflowMetadata,
  StoredWorkflowPinnedLookup,
  StoredWorkflowLastUsedAt,
} from "../../types";
import {
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
} from "../../../workflows/utils";
import { getActionMenuStyle, getActionMenuItemStyle } from "../../styles";

export interface WorkflowSidebarProps {
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  selectedWorkflowId: number | null;
  selectedWorkflow: WorkflowSummary | null;
  loading: boolean;
  loadError: string | null;
  hostedLoading: boolean;
  hostedError: string | null;
  isCreatingWorkflow: boolean;
  isMobileLayout: boolean;
  isSidebarCollapsed: boolean;
  pinnedLookup: StoredWorkflowPinnedLookup;
  lastUsedAt: StoredWorkflowLastUsedAt;
  openWorkflowMenuId: number | string | null;
  workflowMenuPlacement: "up" | "down";
  onSelectWorkflow: (workflowId: number) => void;
  onOpenCreateModal: () => void;
  onDuplicateWorkflow: (workflowId: number) => Promise<void>;
  onRenameWorkflow: (workflowId: number) => Promise<void>;
  onExportWorkflow: (workflowId: number) => Promise<void>;
  onDeleteWorkflow: (workflowId: number) => Promise<void>;
  onDeleteHostedWorkflow: (slug: string) => Promise<void>;
  onToggleLocalPin: (workflowId: number) => void;
  onToggleHostedPin: (slug: string) => void;
  onCloseWorkflowMenu: () => void;
  onSetOpenWorkflowMenuId: (id: number | string | null) => void;
  onSetWorkflowMenuPlacement: (placement: "up" | "down") => void;
  onOpenAppearanceModal: (
    target:
      | { kind: "hosted"; slug: string; label: string; remoteWorkflowId: number | null }
      | { kind: "local"; workflowId: number; slug: string; label: string },
    triggerElement: HTMLElement,
  ) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

type CombinedEntry =
  | { kind: "hosted"; hosted: HostedWorkflowMetadata; isPinned: boolean }
  | { kind: "local"; workflow: WorkflowSummary; isPinned: boolean };

/**
 * WorkflowSidebar component - displays workflow list with search and pinning
 * Provides both expanded (full list) and collapsed (shortcuts) views
 */
export const WorkflowSidebar = ({
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
  onSelectWorkflow,
  onOpenCreateModal,
  onDuplicateWorkflow,
  onRenameWorkflow,
  onExportWorkflow,
  onDeleteWorkflow,
  onDeleteHostedWorkflow,
  onToggleLocalPin,
  onToggleHostedPin,
  onCloseWorkflowMenu,
  onSetOpenWorkflowMenuId,
  onSetWorkflowMenuPlacement,
  onOpenAppearanceModal,
  t,
}: WorkflowSidebarProps) => {
  const expandedContent = useMemo(() => {
    const sectionId = "workflow-builder-sidebar";
    const warningStyle: CSSProperties = {
      color: "var(--text-muted)",
      fontWeight: 600,
    };
    const managedHosted = hostedWorkflows.filter((workflow) => workflow.managed);
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });

    const combinedEntries: CombinedEntry[] = orderWorkflowEntries(
      [
        ...managedHosted.map((hosted) => ({ kind: "hosted" as const, workflow: hosted })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      { collator, pinnedLookup },
    ).map((entry) =>
      entry.kind === "hosted"
        ? {
            kind: "hosted" as const,
            hosted: entry.workflow,
            isPinned: isWorkflowPinned(entry, pinnedLookup),
          }
        : {
            kind: "local" as const,
            workflow: entry.workflow,
            isPinned: isWorkflowPinned(entry, pinnedLookup),
          },
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
          const placement = isMobileLayout && isMenuOpen ? workflowMenuPlacement : "down";
          const menuStyle = getActionMenuStyle(isMobileLayout, placement);
          const pinLabel = isPinned
            ? t("workflows.unpinAction", { label: hosted.label })
            : t("workflows.pinAction", { label: hosted.label });
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
              <div className="chatkit-sidebar__workflow-actions" data-workflow-menu-container="">
                <button
                  type="button"
                  className="chatkit-sidebar__workflow-action-button"
                  data-workflow-menu-trigger=""
                  aria-haspopup="true"
                  aria-expanded={isMenuOpen}
                  aria-controls={menuId}
                  disabled={hostedLoading}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (openWorkflowMenuId === menuKey) {
                      onCloseWorkflowMenu();
                      return;
                    }
                    if (isMobileLayout && typeof window !== "undefined") {
                      const triggerRect = event.currentTarget.getBoundingClientRect();
                      const viewport = window.visualViewport;
                      const viewportHeight =
                        viewport?.height ??
                        window.innerHeight ??
                        document.documentElement.clientHeight ??
                        0;
                      const viewportOffsetTop = viewport?.offsetTop ?? 0;
                      const adjustedTop = triggerRect.top - viewportOffsetTop;
                      const adjustedBottom = triggerRect.bottom - viewportOffsetTop;
                      const spaceAbove = Math.max(0, adjustedTop);
                      const spaceBelow = Math.max(0, viewportHeight - adjustedBottom);
                      const estimatedMenuHeight = 180;
                      const shouldOpenUpwards =
                        spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
                      onSetWorkflowMenuPlacement(shouldOpenUpwards ? "up" : "down");
                    } else {
                      onSetWorkflowMenuPlacement("down");
                    }

                    onSetOpenWorkflowMenuId(menuKey);
                  }}
                >
                  <span aria-hidden="true">…</span>
                  <span className="visually-hidden">
                    {t("workflowBuilder.hostedSection.openActions", { label: hosted.label })}
                  </span>
                </button>
              </div>
              {isMenuOpen ? (
                <div
                  id={menuId}
                  role="menu"
                  data-workflow-menu=""
                  className="chatkit-sidebar__workflow-menu"
                  style={menuStyle}
                >
                  <button
                    type="button"
                    onClick={(event) =>
                      onOpenAppearanceModal(
                        {
                          kind: "hosted",
                          slug: hosted.slug,
                          label: hosted.label,
                          remoteWorkflowId: hosted.remoteWorkflowId ?? null,
                        },
                        event.currentTarget,
                      )
                    }
                    disabled={hostedLoading}
                    style={getActionMenuItemStyle(isMobileLayout, {
                      disabled: hostedLoading,
                    })}
                  >
                    {t("workflowBuilder.hostedSection.customizeAction")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteHostedWorkflow(hosted.slug)}
                    disabled={hostedLoading}
                    style={getActionMenuItemStyle(isMobileLayout, {
                      disabled: hostedLoading,
                      danger: true,
                    })}
                  >
                    {t("workflowBuilder.hostedSection.deleteAction")}
                  </button>
                </div>
              ) : null}
              {!hosted.available ? (
                <p className="chatkit-sidebar__workflow-meta" aria-live="polite">
                  {t("workflows.hostedUnavailable")}
                </p>
              ) : null}
              {hosted.description ? (
                <p className="chatkit-sidebar__workflow-meta">{hosted.description}</p>
              ) : null}
            </li>
          );
        }

        const { workflow, isPinned } = entry;
        const isActive = workflow.id === selectedWorkflowId;
        const isMenuOpen = openWorkflowMenuId === workflow.id;
        const canDuplicate = !loading && workflow.id === selectedWorkflowId;
        const canDelete = !loading && !workflow.is_chatkit_default;
        const menuId = `workflow-actions-${workflow.id}`;
        const placement = isMobileLayout && isMenuOpen ? workflowMenuPlacement : "down";
        const menuStyle = getActionMenuStyle(isMobileLayout, placement);
        const pinLabel = isPinned
          ? t("workflows.unpinAction", { label: workflow.display_name })
          : t("workflows.pinAction", { label: workflow.display_name });
        return (
          <li
            key={`local:${workflow.id}`}
            className="chatkit-sidebar__workflow-list-item chatkit-sidebar__workflow-list-item--with-pin"
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
                isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""
              }`}
              onClick={() => onSelectWorkflow(workflow.id)}
              aria-current={isActive ? "true" : undefined}
              title={workflow.display_name}
            >
              <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
            </button>
            <div className="chatkit-sidebar__workflow-actions" data-workflow-menu-container="">
              <button
                type="button"
                className="chatkit-sidebar__workflow-action-button"
                data-workflow-menu-trigger=""
                aria-haspopup="true"
                aria-expanded={isMenuOpen}
                aria-controls={menuId}
                disabled={loading}
                onClick={(event) => {
                  event.stopPropagation();
                  if (openWorkflowMenuId === workflow.id) {
                    onCloseWorkflowMenu();
                    return;
                  }
                  if (isMobileLayout && typeof window !== "undefined") {
                    const triggerRect = event.currentTarget.getBoundingClientRect();
                    const viewport = window.visualViewport;
                    const viewportHeight =
                      viewport?.height ??
                      window.innerHeight ??
                      document.documentElement.clientHeight ??
                      0;
                    const viewportOffsetTop = viewport?.offsetTop ?? 0;
                    const adjustedTop = triggerRect.top - viewportOffsetTop;
                    const adjustedBottom = triggerRect.bottom - viewportOffsetTop;
                    const spaceAbove = Math.max(0, adjustedTop);
                    const spaceBelow = Math.max(0, viewportHeight - adjustedBottom);
                    const estimatedMenuHeight = 180;
                    const shouldOpenUpwards =
                      spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
                    onSetWorkflowMenuPlacement(shouldOpenUpwards ? "up" : "down");
                  } else {
                    onSetWorkflowMenuPlacement("down");
                  }

                  onSetOpenWorkflowMenuId(workflow.id);
                }}
              >
                <span aria-hidden="true">…</span>
                <span className="visually-hidden">
                  {t("workflowBuilder.localSection.openActions", { label: workflow.display_name })}
                </span>
              </button>
            </div>
            {isMenuOpen ? (
              <div
                id={menuId}
                role="menu"
                data-workflow-menu=""
                className="chatkit-sidebar__workflow-menu"
                style={menuStyle}
              >
                <button
                  type="button"
                  onClick={() => void onDuplicateWorkflow(workflow.id)}
                  disabled={!canDuplicate}
                  style={getActionMenuItemStyle(isMobileLayout, { disabled: !canDuplicate })}
                >
                  {t("workflowBuilder.localSection.duplicateAction")}
                </button>
                <button
                  type="button"
                  onClick={() => void onRenameWorkflow(workflow.id)}
                  disabled={loading}
                  style={getActionMenuItemStyle(isMobileLayout, { disabled: loading })}
                >
                  {t("workflowBuilder.localSection.renameAction")}
                </button>
                <button
                  type="button"
                  onClick={() => void onExportWorkflow(workflow.id)}
                  disabled={loading}
                  style={getActionMenuItemStyle(isMobileLayout, { disabled: loading })}
                >
                  {t("workflowBuilder.localSection.exportAction")}
                </button>
                <button
                  type="button"
                  onClick={(event) =>
                    onOpenAppearanceModal(
                      {
                        kind: "local",
                        workflowId: workflow.id,
                        slug: workflow.slug,
                        label: workflow.display_name,
                      },
                      event.currentTarget,
                    )
                  }
                  disabled={loading}
                  style={getActionMenuItemStyle(isMobileLayout, { disabled: loading })}
                >
                  {t("workflowBuilder.localSection.customizeAction")}
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteWorkflow(workflow.id)}
                  disabled={!canDelete}
                  style={getActionMenuItemStyle(isMobileLayout, {
                    disabled: !canDelete,
                    danger: true,
                  })}
                >
                  {t("workflowBuilder.localSection.deleteAction")}
                </button>
              </div>
            ) : null}
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
          <p className="chatkit-sidebar__section-text">{selectedWorkflow.description}</p>
        ) : null}
        {selectedWorkflow && !selectedWorkflow.active_version_id ? (
          <p
            className="chatkit-sidebar__section-text"
            style={{ color: "var(--text-muted)", fontWeight: 600 }}
          >
            Publiez une version pour l'utiliser.
          </p>
        ) : null}
      </section>
    );
  }, [
    hostedWorkflows,
    workflows,
    lastUsedAt,
    pinnedLookup,
    loading,
    loadError,
    hostedError,
    hostedLoading,
    openWorkflowMenuId,
    isMobileLayout,
    workflowMenuPlacement,
    onToggleHostedPin,
    onToggleLocalPin,
    onSelectWorkflow,
    selectedWorkflowId,
    onCloseWorkflowMenu,
    onSetWorkflowMenuPlacement,
    onSetOpenWorkflowMenuId,
    onOpenAppearanceModal,
    onDeleteHostedWorkflow,
    onDuplicateWorkflow,
    onRenameWorkflow,
    onExportWorkflow,
    onDeleteWorkflow,
    isCreatingWorkflow,
    onOpenCreateModal,
    selectedWorkflow,
    t,
  ]);

  const collapsedContent = useMemo(() => {
    if (loadError) {
      return null;
    }

    const managedHosted = hostedWorkflows.filter((workflow) => workflow.managed);
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const orderedEntries = orderWorkflowEntries(
      [
        ...managedHosted.map((workflow) => ({ kind: "hosted" as const, workflow })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      { collator, pinnedLookup },
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
        };
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
      };
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
          <div
            className="chatkit-sidebar__workflow-compact-group"
            data-workflow-group="default"
          >
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
    loadError,
    hostedWorkflows,
    workflows,
    lastUsedAt,
    pinnedLookup,
    onSelectWorkflow,
    loading,
    selectedWorkflowId,
    isSidebarCollapsed,
    t,
  ]);

  return {
    expandedContent,
    collapsedContent,
  };
};
