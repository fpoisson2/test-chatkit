import { useMemo, type CSSProperties, type MutableRefObject } from "react";

import { useI18n } from "../../i18n";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import {
  orderWorkflowEntries,
  isWorkflowPinned,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinnedLookup,
} from "./utils";
import type { ActionMenuPlacement, WorkflowActionMenuItem } from "./WorkflowActionMenu";
import WorkflowSidebarListItem from "./WorkflowSidebarListItem";

type WorkflowListVariant = "chat" | "builder";

export type WorkflowListProps = {
  // Data
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;

  // State
  loading: boolean;
  loadError: string | null;
  hostedLoading?: boolean;
  hostedError?: string | null;

  // Selection (different for chat vs builder)
  selectedWorkflowId?: number | null;
  selectedHostedSlug?: string | null;
  isHostedMode?: boolean;

  // Menu state
  openWorkflowMenuId: string | number | null;
  workflowMenuPlacement: ActionMenuPlacement;
  setOpenWorkflowMenuId: (id: string | number | null) => void;
  setWorkflowMenuPlacement: (placement: ActionMenuPlacement) => void;
  closeWorkflowMenu: () => void;
  workflowMenuTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  workflowMenuRef: MutableRefObject<HTMLDivElement | null>;

  // Callbacks
  onSelectLocalWorkflow?: (workflowId: number) => void;
  onSelectHostedWorkflow?: (slug: string) => void;
  onRenameWorkflow?: (workflowId: number) => void;
  onDeleteWorkflow?: (workflowId: number) => void | Promise<void>;
  onDuplicateWorkflow?: (workflowId?: number) => void | Promise<void>;
  onExportWorkflow?: (workflowId?: number) => void | Promise<void>;
  onDeleteHostedWorkflow?: (slug: string) => void | Promise<void>;
  onOpenAppearanceModal?: (
    target: { kind: "local" | "hosted"; workflowId?: number; slug: string; label: string },
    trigger?: HTMLButtonElement | null
  ) => void;
  onToggleLocalPin: (workflowId: number) => void;
  onToggleHostedPin: (slug: string) => void;

  // UI
  isMobileLayout: boolean;
  variant: WorkflowListVariant;
  workflowSortCollator: Intl.Collator | null;

  // Optional extras
  showCreateButton?: boolean;
  onOpenCreateModal?: () => void;
  isCreatingWorkflow?: boolean;
  selectedWorkflowDescription?: string;
  showProductionWarning?: boolean;
};

export const WorkflowList = ({
  workflows,
  hostedWorkflows,
  lastUsedAt,
  pinnedLookup,
  loading,
  loadError,
  hostedLoading,
  hostedError,
  selectedWorkflowId,
  selectedHostedSlug,
  isHostedMode,
  openWorkflowMenuId,
  workflowMenuPlacement,
  setOpenWorkflowMenuId,
  setWorkflowMenuPlacement,
  closeWorkflowMenu,
  workflowMenuTriggerRef,
  workflowMenuRef,
  onSelectLocalWorkflow,
  onSelectHostedWorkflow,
  onRenameWorkflow,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onExportWorkflow,
  onDeleteHostedWorkflow,
  onOpenAppearanceModal,
  onToggleLocalPin,
  onToggleHostedPin,
  isMobileLayout,
  variant,
  workflowSortCollator,
  showCreateButton,
  onOpenCreateModal,
  isCreatingWorkflow,
  selectedWorkflowDescription,
  showProductionWarning,
}: WorkflowListProps) => {
  const { t } = useI18n();

  const orderingCollator = useMemo(() => {
    if (workflowSortCollator) {
      return workflowSortCollator;
    }
    if (typeof Intl !== "undefined" && typeof Intl.Collator === "function") {
      return new Intl.Collator(undefined, { sensitivity: "base" });
    }
    return null;
  }, [workflowSortCollator]);

  const managedHosted = useMemo(
    () => hostedWorkflows.filter((workflow) => workflow.managed),
    [hostedWorkflows]
  );

  type CombinedEntry =
    | { kind: "hosted"; hosted: HostedWorkflowMetadata; isPinned: boolean }
    | { kind: "local"; workflow: WorkflowSummary; isPinned: boolean };

  const combinedEntries = useMemo<CombinedEntry[]>(() => {
    const orderingOptions = orderingCollator
      ? { collator: orderingCollator, pinnedLookup }
      : { pinnedLookup };

    return orderWorkflowEntries(
      [
        ...managedHosted.map((hosted) => ({ kind: "hosted" as const, workflow: hosted })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      orderingOptions
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
          } satisfies CombinedEntry)
    );
  }, [lastUsedAt, managedHosted, orderingCollator, pinnedLookup, workflows]);

  const { pinnedEntries, regularEntries } = useMemo(() => {
    const pinned: CombinedEntry[] = [];
    const regular: CombinedEntry[] = [];

    for (const entry of combinedEntries) {
      if (entry.isPinned) {
        pinned.push(entry);
      } else {
        regular.push(entry);
      }
    }

    return { pinnedEntries: pinned, regularEntries: regular };
  }, [combinedEntries]);

  const warningStyle: CSSProperties = {
    color: "var(--text-muted)",
    fontWeight: 600,
  };

  const renderEntry = (entry: CombinedEntry) => {
    if (entry.kind === "hosted") {
      const { hosted, isPinned } = entry;
      const menuKey = `hosted:${hosted.slug}`;
      const isMenuOpen = openWorkflowMenuId === menuKey;
      const menuId = `workflow-actions-${hosted.slug}`;
      const isSelected = isHostedMode && selectedHostedSlug === hosted.slug;
      const pinLabel = isPinned
        ? t("workflows.unpinAction", { label: hosted.label })
        : t("workflows.pinAction", { label: hosted.label });

      const hostedMenuItems: WorkflowActionMenuItem[] = [
        {
          key: "appearance",
          label: t("workflowBuilder.hostedSection.customizeAction"),
          onSelect: (event) =>
            onOpenAppearanceModal?.(
              {
                kind: "hosted",
                slug: hosted.slug,
                label: hosted.label,
              },
              event.currentTarget
            ),
          disabled: variant === "chat",
        },
        {
          key: "delete",
          label: t("workflowBuilder.hostedSection.deleteAction"),
          onSelect: () => void onDeleteHostedWorkflow?.(hosted.slug),
          disabled: variant === "chat",
          danger: true,
        },
      ];

      return (
        <WorkflowSidebarListItem
          key={`hosted:${hosted.slug}`}
          isPinned={isPinned}
          pinLabel={pinLabel}
          onTogglePin={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleHostedPin(hosted.slug);
          }}
          menuProps={
            variant === "builder"
              ? {
                  menuId,
                  isOpen: isMenuOpen,
                  isMobileLayout,
                  placement: isMenuOpen ? workflowMenuPlacement : "down",
                  triggerDisabled: hostedLoading || loading,
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
                }
              : null
          }
          dataAttributes={{ "data-hosted-workflow": "" }}
        >
          <button
            type="button"
            className={`chatkit-sidebar__workflow-button chatkit-sidebar__workflow-button--hosted${
              isSelected ? " chatkit-sidebar__workflow-button--active" : ""
            }${isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""}`}
            onClick={variant === "chat" ? () => onSelectHostedWorkflow?.(hosted.slug) : undefined}
            disabled={variant === "builder"}
            aria-disabled={variant === "builder" ? "true" : undefined}
            tabIndex={variant === "builder" ? -1 : undefined}
            aria-current={isSelected ? "true" : undefined}
            title={hosted.description ?? t("workflows.hostedBadge")}
          >
            <span className="chatkit-sidebar__workflow-label">{hosted.label}</span>
            <span className="chatkit-sidebar__workflow-badge chatkit-sidebar__workflow-badge--hosted">
              {t("workflows.hostedBadge")}
            </span>
          </button>
        </WorkflowSidebarListItem>
      );
    }

    // Local workflow
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
        onSelect: () => void onDuplicateWorkflow?.(workflow.id),
        disabled: !canDuplicate,
      },
      {
        key: "rename",
        label: t("workflowBuilder.localSection.renameAction"),
        onSelect: () => void onRenameWorkflow?.(workflow.id),
        disabled: loading,
      },
      {
        key: "export",
        label: t("workflowBuilder.localSection.exportAction"),
        onSelect: () => void onExportWorkflow?.(workflow.id),
        disabled: loading,
      },
      {
        key: "appearance",
        label: t("workflowBuilder.localSection.customizeAction"),
        onSelect: (event) =>
          onOpenAppearanceModal?.(
            {
              kind: "local",
              workflowId: workflow.id,
              slug: workflow.slug,
              label: workflow.display_name,
            },
            event.currentTarget
          ),
        disabled: loading,
      },
      {
        key: "delete",
        label: t("workflowBuilder.localSection.deleteAction"),
        onSelect: () => void onDeleteWorkflow?.(workflow.id),
        disabled: !canDelete,
        danger: true,
      },
    ];

    return (
      <WorkflowSidebarListItem
        key={`local:${workflow.id}`}
        isPinned={isPinned}
        pinLabel={pinLabel}
        onTogglePin={(event) => {
          event.stopPropagation();
          onToggleLocalPin(workflow.id);
        }}
        menuProps={
          variant === "builder"
            ? {
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
              }
            : null
        }
        dataAttributes={{
          "data-local-workflow": "",
          "data-selected": isActive ? "" : undefined,
        }}
        trailingContent={
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
        }
      >
        <button
          type="button"
          className={`chatkit-sidebar__workflow-button${
            isActive ? " chatkit-sidebar__workflow-button--active" : ""
          }${isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""}`}
          onClick={() => onSelectLocalWorkflow?.(workflow.id)}
          disabled={loading}
          aria-current={isActive ? "true" : undefined}
          title={workflow.description ?? undefined}
        >
          <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
        </button>
      </WorkflowSidebarListItem>
    );
  };

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
        {!hostedLoading && !hostedError && managedHosted.length === 0 && variant === "builder" ? (
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

  const sectionId = variant === "chat" ? "chat-sidebar-workflow" : "workflow-builder-sidebar";
  const sectionClassName = showCreateButton
    ? "chatkit-sidebar__section chatkit-sidebar__section--with-floating-action"
    : "chatkit-sidebar__section";

  return (
    <div key="workflow-sidebar-content" data-sidebar-type="workflows">
      <section className={sectionClassName} aria-labelledby={`${sectionId}-title`}>
        <h2 id={`${sectionId}-title`} className="visually-hidden">
          {t("workflows.defaultSectionTitle")}
        </h2>
        {showCreateButton && onOpenCreateModal ? (
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
        ) : null}
        {renderWorkflowList()}
        {selectedWorkflowDescription ? (
          <p className="chatkit-sidebar__section-text">{selectedWorkflowDescription}</p>
        ) : null}
        {showProductionWarning ? (
          <p className="chatkit-sidebar__section-text" style={warningStyle}>
            Publiez une version pour l'utiliser.
          </p>
        ) : null}
      </section>
    </div>
  );
};
