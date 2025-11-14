import { useMemo, type MutableRefObject, type ReactNode } from "react";

import { useI18n } from "../../../i18n";
import {
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinnedLookup,
} from "../utils";
import type {
  ActionMenuPlacement,
  WorkflowActionMenuItem,
} from "../WorkflowActionMenu";
import type { WorkflowSidebarSectionEntry } from "../WorkflowSidebarSection";
import type { HostedWorkflowMetadata } from "../../../utils/backend";
import type { WorkflowSummary } from "../../../types/workflows";

export type WorkflowEntryCallbacks = {
  onHostedClick?: (slug: string) => void;
  onLocalClick?: (id: number) => void;
  onToggleHostedPin: (slug: string) => void;
  onToggleLocalPin: (id: number) => void;
};

export type WorkflowEntryMenuConfig = {
  openWorkflowMenuId: string | number | null;
  workflowMenuPlacement: ActionMenuPlacement;
  workflowMenuTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  workflowMenuRef: MutableRefObject<HTMLDivElement | null>;
  onOpenMenu: (id: string | number, placement: ActionMenuPlacement) => void;
  onCloseMenu: () => void;
};

export type HostedWorkflowMenuItems = (params: {
  hosted: HostedWorkflowMetadata;
  isPinned: boolean;
  t: ReturnType<typeof useI18n>["t"];
  onTogglePin: () => void;
  onCloseMenu: () => void;
}) => WorkflowActionMenuItem[];

export type LocalWorkflowMenuItems = (params: {
  workflow: WorkflowSummary;
  isPinned: boolean;
  isActive: boolean;
  t: ReturnType<typeof useI18n>["t"];
  onTogglePin: () => void;
  onCloseMenu: () => void;
}) => WorkflowActionMenuItem[];

export type WorkflowEntryConfig = {
  workflows: WorkflowSummary[];
  hostedWorkflows: HostedWorkflowMetadata[];
  lastUsedAt: StoredWorkflowLastUsedAt;
  pinnedLookup: StoredWorkflowPinnedLookup;
  workflowCollator: Intl.Collator | null;
  isMobileLayout: boolean;
  selectedWorkflowId?: number | null;
  selectedHostedSlug?: string | null;
  loading?: boolean;
  hostedLoading?: boolean;
  callbacks: WorkflowEntryCallbacks;
  menuConfig?: WorkflowEntryMenuConfig;
  hostedMenuItems?: HostedWorkflowMenuItems;
  localMenuItems?: LocalWorkflowMenuItems;
  hostedTrailingContent?: (hosted: HostedWorkflowMetadata) => ReactNode;
  localTrailingContent?: (workflow: WorkflowSummary) => ReactNode;
};

export const useWorkflowSidebarEntries = (
  config: WorkflowEntryConfig,
): WorkflowSidebarSectionEntry[] => {
  const { t } = useI18n();
  const {
    workflows,
    hostedWorkflows,
    lastUsedAt,
    pinnedLookup,
    workflowCollator,
    isMobileLayout,
    selectedWorkflowId,
    selectedHostedSlug,
    loading = false,
    hostedLoading = false,
    callbacks,
    menuConfig,
    hostedMenuItems,
    localMenuItems,
    hostedTrailingContent,
    localTrailingContent,
  } = config;

  const sortedWorkflowEntries = useMemo(() => {
    const collator =
      workflowCollator ?? new Intl.Collator(undefined, { sensitivity: "base" });
    return orderWorkflowEntries(
      [
        ...hostedWorkflows.map((workflow) => ({ kind: "hosted" as const, workflow })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      { collator, pinnedLookup },
    );
  }, [hostedWorkflows, lastUsedAt, pinnedLookup, workflowCollator, workflows]);

  return useMemo<WorkflowSidebarSectionEntry[]>(
    () =>
      sortedWorkflowEntries.map((entry) => {
        if (entry.kind === "hosted") {
          const hosted = entry.workflow;
          const isPinned = isWorkflowPinned(entry, pinnedLookup);
          const isSelected = selectedHostedSlug === hosted.slug;
          const menuKey = `hosted:${hosted.slug}`;
          const isMenuOpen = menuConfig?.openWorkflowMenuId === menuKey;
          const menuId = `workflow-actions-${hosted.slug}`;
          const pinLabel = isPinned
            ? t("workflows.unpinAction", { label: hosted.label })
            : t("workflows.pinAction", { label: hosted.label });

          const items =
            hostedMenuItems?.({
              hosted,
              isPinned,
              t,
              onTogglePin: () => callbacks.onToggleHostedPin(hosted.slug),
              onCloseMenu: () => menuConfig?.onCloseMenu(),
            }) ?? [];

          return {
            key: menuKey,
            kind: "hosted" as const,
            isPinned,
            pinLabel,
            onTogglePin: (event) => {
              event.preventDefault();
              event.stopPropagation();
              callbacks.onToggleHostedPin(hosted.slug);
            },
            menuProps: menuConfig && items.length > 0
              ? {
                  menuId,
                  isOpen: isMenuOpen,
                  isMobileLayout,
                  placement: isMenuOpen ? menuConfig.workflowMenuPlacement : "down",
                  triggerDisabled: hostedLoading,
                  triggerLabel: t("workflowBuilder.hostedSection.openActions", {
                    label: hosted.label,
                  }),
                  onOpen: (placement) => {
                    menuConfig.onOpenMenu(menuKey, placement);
                  },
                  onClose: menuConfig.onCloseMenu,
                  triggerRef: menuConfig.workflowMenuTriggerRef,
                  menuRef: menuConfig.workflowMenuRef,
                  items,
                  variant: isMobileLayout ? "overlay" : "default",
                }
              : null,
            hasActions: menuConfig && items.length > 0,
            dataAttributes: { "data-hosted-workflow": "" },
            showPinButton: !isMobileLayout,
            trailingContent: hostedTrailingContent?.(hosted),
            content: (
              <button
                type="button"
                className={`chatkit-sidebar__workflow-button chatkit-sidebar__workflow-button--hosted${
                  isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""
                }`}
                onClick={callbacks.onHostedClick ? () => callbacks.onHostedClick!(hosted.slug) : undefined}
                disabled={!hosted.available || !callbacks.onHostedClick}
                aria-current={isSelected ? "true" : undefined}
                aria-disabled={!callbacks.onHostedClick ? "true" : undefined}
                tabIndex={!callbacks.onHostedClick ? -1 : undefined}
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
              onClick: callbacks.onHostedClick ? () => callbacks.onHostedClick!(hosted.slug) : undefined,
              disabled: !hosted.available || !callbacks.onHostedClick,
              isActive: isSelected,
              ariaLabel: t("workflows.hostedCompactLabel", { label: hosted.label }),
              hiddenLabelSuffix: t("workflows.hostedBadge"),
            },
          } satisfies WorkflowSidebarSectionEntry;
        }

        const workflow = entry.workflow;
        const isPinned = isWorkflowPinned(entry, pinnedLookup);
        const isActive = workflow.id === selectedWorkflowId;
        const hasProduction = workflow.active_version_id !== null;
        const menuId = `workflow-actions-${workflow.id}`;
        const isMenuOpen = menuConfig?.openWorkflowMenuId === workflow.id;
        const pinLabel = isPinned
          ? t("workflows.unpinAction", { label: workflow.display_name })
          : t("workflows.pinAction", { label: workflow.display_name });

        const items =
          localMenuItems?.({
            workflow,
            isPinned,
            isActive,
            t,
            onTogglePin: () => callbacks.onToggleLocalPin(workflow.id),
            onCloseMenu: () => menuConfig?.onCloseMenu(),
          }) ?? [];

        return {
          key: `local:${workflow.id}`,
          kind: "local" as const,
          isPinned,
          pinLabel,
          onTogglePin: (event) => {
            event.preventDefault();
            event.stopPropagation();
            callbacks.onToggleLocalPin(workflow.id);
          },
          menuProps: menuConfig && items.length > 0
            ? {
                menuId,
                isOpen: isMenuOpen,
                isMobileLayout,
                placement: isMenuOpen ? menuConfig.workflowMenuPlacement : "down",
                triggerDisabled: loading,
                triggerLabel: t("workflowBuilder.localSection.openActions", {
                  label: workflow.display_name,
                }),
                onOpen: (placement) => {
                  menuConfig.onOpenMenu(workflow.id, placement);
                },
                onClose: menuConfig.onCloseMenu,
                triggerRef: menuConfig.workflowMenuTriggerRef,
                menuRef: menuConfig.workflowMenuRef,
                items,
                variant: isMobileLayout ? "overlay" : "default",
              }
            : null,
          hasActions: menuConfig && items.length > 0,
          dataAttributes: {
            "data-local-workflow": "",
            "data-selected": isActive ? "" : undefined,
          },
          showPinButton: !isMobileLayout,
          trailingContent: localTrailingContent?.(workflow),
          content: (
            <button
              type="button"
              className={`chatkit-sidebar__workflow-button${
                isActive ? " chatkit-sidebar__workflow-button--active" : ""
              }${isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""}`}
              onClick={callbacks.onLocalClick ? () => callbacks.onLocalClick!(workflow.id) : undefined}
              disabled={!hasProduction || !callbacks.onLocalClick || loading}
              aria-current={isActive ? "true" : undefined}
              title={workflow.description ?? undefined}
            >
              <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
            </button>
          ),
          compact: {
            label: workflow.display_name,
            initials: getWorkflowInitials(workflow.display_name),
            onClick: callbacks.onLocalClick ? () => callbacks.onLocalClick!(workflow.id) : undefined,
            disabled: !hasProduction || loading,
            isActive,
            ariaLabel: workflow.display_name,
          },
        } satisfies WorkflowSidebarSectionEntry;
      }),
    [
      sortedWorkflowEntries,
      pinnedLookup,
      selectedHostedSlug,
      selectedWorkflowId,
      menuConfig,
      hostedLoading,
      t,
      callbacks,
      hostedMenuItems,
      localMenuItems,
      hostedTrailingContent,
      localTrailingContent,
      isMobileLayout,
      loading,
    ],
  );
};
