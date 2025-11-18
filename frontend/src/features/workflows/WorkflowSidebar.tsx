/**
 * WorkflowSidebar - Unified sidebar component for workflow selection and management
 *
 * This file contains:
 * 1. useWorkflowSidebarEntries - Shared hook for generating sidebar entries
 * 2. ChatWorkflowSidebar - Sidebar for the Chat interface
 * 3. WorkflowBuilderSidebar - Sidebar for the Workflow Builder interface
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { LoadingSpinner } from "../../components/feedback/LoadingSpinner";
import { workflowsApi } from "../../utils/backend";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";
import { useDuplicateWorkflow } from "../../hooks/useWorkflows";
import { useEscapeKeyHandler } from "../workflow-builder/hooks/useEscapeKeyHandler";
import { useOutsidePointerDown } from "../workflow-builder/hooks/useOutsidePointerDown";
import type { WorkflowAppearanceTarget } from "./WorkflowAppearanceModal";
import type {
  ActionMenuPlacement,
  WorkflowActionMenuItem,
} from "./WorkflowActionMenu";
import WorkflowSidebarSection, {
  WorkflowSidebarCompact,
} from "./WorkflowSidebarSection";
import type { WorkflowSidebarListItemMenuProps } from "./WorkflowSidebarListItem";
import {
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
  recordWorkflowLastUsedAt,
  readStoredWorkflowLastUsedMap,
  createEmptyStoredWorkflowPinned,
  updateStoredWorkflowSelection,
  type StoredWorkflowLastUsedAt,
  type StoredWorkflowPinnedLookup,
  type WorkflowSortMode,
} from "./utils";
import { useWorkflowSidebar } from "./WorkflowSidebarProvider";
import { useWorkflowContext } from "../workflow-builder/contexts/WorkflowContext";
import { useModalContext } from "../workflow-builder/contexts/ModalContext";
import { useUIContext } from "../workflow-builder/contexts/UIContext";

// ============================================================================
// Shared Hook: useWorkflowSidebarEntries
// ============================================================================

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
  sortMode?: WorkflowSortMode;
};

export type WorkflowSidebarSectionEntry = {
  key: string;
  kind: "local" | "hosted";
  isPinned: boolean;
  menuProps?: WorkflowSidebarListItemMenuProps | null;
  hasActions?: boolean;
  dataAttributes?: Record<string, boolean | string | null | undefined>;
  content: ReactNode;
  trailingContent?: ReactNode;
  compact?: {
    key?: string;
    label: string;
    initials: string;
    onClick?: () => void;
    disabled?: boolean;
    isActive?: boolean;
    ariaLabel?: string;
    hiddenLabelSuffix?: string;
  } | null;
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
    sortMode = "recent",
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
      { collator, pinnedLookup, sortMode },
    );
  }, [hostedWorkflows, lastUsedAt, pinnedLookup, workflowCollator, workflows, sortMode]);

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
                onOpen: (placement: ActionMenuPlacement) => {
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
            trailingContent: hostedTrailingContent?.(hosted),
            content: (
              <button
                type="button"
                className={`chatkit-sidebar__workflow-button chatkit-sidebar__workflow-button--hosted${isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""
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
              onOpen: (placement: ActionMenuPlacement) => {
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
          trailingContent: localTrailingContent?.(workflow),
          content: (
            <button
              type="button"
              className={`chatkit-sidebar__workflow-button${isActive ? " chatkit-sidebar__workflow-button--active" : ""
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

// ============================================================================
// ChatWorkflowSidebar
// ============================================================================

const isApiError = (error: unknown): error is { status?: number; message?: string } =>
  Boolean(error) && typeof error === "object" && "status" in error;

type ActivationContext = { reason: "initial" | "user" };

type HostedWorkflowSelection = {
  kind: "hosted";
  slug: string;
  option: HostedWorkflowMetadata;
};

type LocalWorkflowSelection = {
  kind: "local";
  workflow: WorkflowSummary | null;
};

export type WorkflowActivation = HostedWorkflowSelection | LocalWorkflowSelection;

type ChatWorkflowSidebarProps = {
  mode: HostedFlowMode;
  setMode: (mode: HostedFlowMode) => void;
  onWorkflowActivated: (selection: WorkflowActivation, context: ActivationContext) => void;
};

export const ChatWorkflowSidebar = ({ mode, setMode, onWorkflowActivated }: ChatWorkflowSidebarProps) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { closeSidebar, isDesktopLayout, isSidebarCollapsed } = useAppLayout();
  const isMobileLayout = !isDesktopLayout;
  const { setSidebarContent, setCollapsedSidebarContent, clearSidebarContent } = useSidebarPortal();
  const { token, user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const isLtiUser = Boolean(user?.is_lti);

  // Use the shared workflow sidebar state
  const {
    workflows,
    hostedWorkflows,
    selectedWorkflowId,
    selectedHostedSlug,
    loading,
    error,
    lastUsedAt,
    pinnedLookup,
    workflowCollator,
    toggleLocalPin,
    toggleHostedPin,
    loadWorkflows,
    setWorkflows,
    setSelectedWorkflowId,
    setSelectedHostedSlug,
  } = useWorkflowSidebar();

  const [updatingWorkflowId, setUpdatingWorkflowId] = useState<number | null>(null);
  const hostedInitialAnnouncedRef = useRef(false);
  const onWorkflowActivatedRef = useRef(onWorkflowActivated);
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);
  const [workflowMenuPlacement, setWorkflowMenuPlacement] = useState<ActionMenuPlacement>("down");
  const workflowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);
  const duplicateWorkflowMutation = useDuplicateWorkflow();
  const [sortMode, setSortMode] = useState<WorkflowSortMode>("recent");

  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("down");
    workflowMenuTriggerRef.current = null;
    workflowMenuRef.current = null;
  }, []);

  useEffect(() => {
    onWorkflowActivatedRef.current = onWorkflowActivated;
  }, [onWorkflowActivated]);

  useOutsidePointerDown(
    [workflowMenuTriggerRef, workflowMenuRef],
    closeWorkflowMenu,
    { enabled: openWorkflowMenuId !== null },
  );

  useEscapeKeyHandler(
    () => {
      closeWorkflowMenu();
    },
    { enabled: openWorkflowMenuId !== null },
  );

  useEffect(() => {
    if (openWorkflowMenuId === null) {
      return;
    }

    if (typeof openWorkflowMenuId === "number") {
      if (!workflows.some((workflow) => workflow.id === openWorkflowMenuId)) {
        closeWorkflowMenu();
      }
      return;
    }

    if (typeof openWorkflowMenuId === "string" && openWorkflowMenuId.startsWith("hosted:")) {
      const slug = openWorkflowMenuId.slice("hosted:".length);
      if (!hostedWorkflows.some((entry) => entry.slug === slug)) {
        closeWorkflowMenu();
      }
    }
  }, [closeWorkflowMenu, hostedWorkflows, openWorkflowMenuId, workflows]);

  useEffect(() => {
    if (!isAdmin && openWorkflowMenuId !== null) {
      closeWorkflowMenu();
    }
  }, [closeWorkflowMenu, isAdmin, openWorkflowMenuId]);

  // Announce initial workflow selection
  useEffect(() => {
    if (mode !== "hosted") {
      hostedInitialAnnouncedRef.current = false;
      return;
    }

    if (hostedWorkflows.length === 0) {
      return;
    }

    const ensureSelectedSlug = () => {
      if (selectedHostedSlug && hostedWorkflows.some((entry) => entry.slug === selectedHostedSlug)) {
        return selectedHostedSlug;
      }
      const preferred = hostedWorkflows.find((entry) => entry.available) ?? hostedWorkflows[0];
      const slug = preferred?.slug ?? null;
      if (slug && slug !== selectedHostedSlug) {
        setSelectedHostedSlug(slug);
      }
      return slug;
    };

    const activeSlug = ensureSelectedSlug();
    if (!activeSlug) {
      return;
    }

    if (!hostedInitialAnnouncedRef.current) {
      const option = hostedWorkflows.find((entry) => entry.slug === activeSlug);
      if (option) {
        hostedInitialAnnouncedRef.current = true;
        onWorkflowActivatedRef.current(
          { kind: "hosted", slug: option.slug, option },
          { reason: "initial" },
        );
      }
    }
  }, [hostedWorkflows, mode, selectedHostedSlug, setSelectedHostedSlug]);

  // Announce initial local workflow selection (only on first load)
  // Skip this for LTI users - they have their own auto-selection logic below
  const hasAnnouncedInitialLocal = useRef(false);
  useEffect(() => {
    if (hasAnnouncedInitialLocal.current || mode !== "local" || !workflows.length) {
      return;
    }

    // Skip for LTI users - they have dedicated auto-selection logic
    if (isLtiUser) {
      return;
    }

    const workflow = workflows.find((w) => w.id === selectedWorkflowId) ?? null;
    hasAnnouncedInitialLocal.current = true;
    onWorkflowActivatedRef.current(
      { kind: "local", workflow },
      { reason: "initial" },
    );
  }, [mode, selectedWorkflowId, workflows, isLtiUser]);

  // Auto-select LTI workflow for LTI users
  const hasCheckedLtiWorkflow = useRef(false);
  useEffect(() => {
    if (hasCheckedLtiWorkflow.current || !user || loading) {
      return;
    }

    // Check if user is LTI user
    if (!user.is_lti) {
      hasCheckedLtiWorkflow.current = true;
      return;
    }

    // Wait for workflows to be loaded before checking
    if (workflows.length === 0) {
      console.log('[LTI Auto-select] Waiting for workflows to load...');
      return;
    }

    console.log('[LTI Auto-select] Workflows loaded:', workflows.length, workflows.map(w => ({ id: w.id, name: w.display_name })));

    // Get the workflow ID from the LTI launch (stored in localStorage)
    const ltiWorkflowId = localStorage.getItem('lti_launch_workflow_id');
    if (!ltiWorkflowId) {
      console.log('[LTI Auto-select] No workflow ID found in localStorage');
      hasCheckedLtiWorkflow.current = true;
      return;
    }

    console.log('[LTI Auto-select] Found workflow ID in localStorage:', ltiWorkflowId);

    // Convert to number and clear from localStorage (one-time use)
    const workflowId = parseInt(ltiWorkflowId, 10);
    localStorage.removeItem('lti_launch_workflow_id');

    if (isNaN(workflowId)) {
      console.error('[LTI Auto-select] Invalid workflow ID:', ltiWorkflowId);
      hasCheckedLtiWorkflow.current = true;
      return;
    }

    // Find the workflow in the list (loaded via API with LTI user permissions)
    const workflowInList = workflows.find((w) => w.id === workflowId);

    if (workflowInList) {
      console.log('[LTI Auto-select] Auto-selecting workflow:', workflowId, workflowInList.display_name);
      console.log('[LTI Auto-select] Workflow options:', {
        lti_enabled: workflowInList.lti_enabled,
        lti_show_sidebar: workflowInList.lti_show_sidebar,
        lti_show_header: workflowInList.lti_show_header
      });

      // Update selected workflow ID if different
      if (selectedWorkflowId !== workflowId) {
        setSelectedWorkflowId(workflowId);
        updateStoredWorkflowSelection((previous) => ({
          mode: "local",
          localWorkflowId: workflowId,
          hostedSlug: previous?.hostedSlug ?? null,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
        }));
      }

      // ALWAYS activate the workflow for LTI users, even if already selected
      // This ensures the workflow is properly initialized with LTI options
      onWorkflowActivatedRef.current(
        { kind: "local", workflow: workflowInList },
        { reason: "initial" },
      );
      console.log('[LTI Auto-select] Workflow activated successfully');
    } else {
      console.error('[LTI Auto-select] Workflow not found:', workflowId, 'Available:', workflows.map(w => w.id));
    }

    hasCheckedLtiWorkflow.current = true;
  }, [user, workflows, selectedWorkflowId, setSelectedWorkflowId, loading]);

  const handleWorkflowClick = useCallback(
    async (workflowId: number) => {
      if (!token || workflowId === selectedWorkflowId || updatingWorkflowId !== null) {
        return;
      }

      const workflowToActivate = workflows.find((workflow) => workflow.id === workflowId);
      if (!workflowToActivate || workflowToActivate.active_version_id === null) {
        return;
      }

      const isLtiUser = user?.is_lti;

      // LTI users can select workflows locally without API call
      if (isLtiUser) {
        setSelectedWorkflowId(workflowId);
        updateStoredWorkflowSelection((previous) => ({
          mode: "local",
          localWorkflowId: workflowId,
          hostedSlug: previous?.hostedSlug ?? null,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
        }));
        onWorkflowActivatedRef.current(
          { kind: "local", workflow: workflowToActivate },
          { reason: "user" },
        );
        if (!isDesktopLayout) {
          closeSidebar();
        }
        recordWorkflowLastUsedAt({
          kind: "local",
          workflow: workflowToActivate,
        });
        return;
      }

      // Admin users can set the default workflow via API
      if (!isAdmin) {
        return;
      }

      setUpdatingWorkflowId(workflowId);
      try {
        const updated = await workflowsApi.setChatkitWorkflow(token, workflowId);
        setWorkflows((current) => {
          const exists = current.some((workflow) => workflow.id === updated.id);
          if (!exists) {
            return [
              ...current.map((workflow) => ({
                ...workflow,
                is_chatkit_default: false,
              })),
              updated,
            ];
          }
          return current.map((workflow) =>
            workflow.id === updated.id ? updated : { ...workflow, is_chatkit_default: false },
          );
        });
        setSelectedWorkflowId(updated.id);
        updateStoredWorkflowSelection((previous) => ({
          mode: "local",
          localWorkflowId: updated.id,
          hostedSlug: previous?.hostedSlug ?? null,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
        }));
        onWorkflowActivatedRef.current(
          { kind: "local", workflow: updated.active_version_id ? updated : null },
          { reason: "user" },
        );
        if (!isDesktopLayout) {
          closeSidebar();
        }
        recordWorkflowLastUsedAt({
          kind: "local",
          workflow: updated,
        });
      } catch (err) {
        // Error handling will be shown by parent component if needed
        if (import.meta.env.DEV) {
          console.error("Failed to set workflow:", err);
        }
      } finally {
        setUpdatingWorkflowId(null);
      }
    },
    [
      closeSidebar,
      isAdmin,
      isDesktopLayout,
      updatingWorkflowId,
      selectedWorkflowId,
      setSelectedWorkflowId,
      setWorkflows,
      token,
      user,
      workflows,
    ],
  );

  const handleDuplicateWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!token || !isAdmin) {
        return;
      }

      if (workflow.active_version_id === null) {
        return;
      }

      const baseName = workflow.display_name?.trim() || "Workflow sans nom";
      const proposed = window.prompt("Nom du duplicata ?", `${baseName} (copie)`);
      if (!proposed) {
        return;
      }

      const displayName = proposed.trim();
      if (!displayName) {
        return;
      }

      setUpdatingWorkflowId(workflow.id);
      try {
        const duplicated = await duplicateWorkflowMutation.mutateAsync({
          token,
          id: workflow.id,
          newName: displayName,
        });

        await loadWorkflows();
        setSelectedWorkflowId(duplicated.id);
        updateStoredWorkflowSelection((previous) => ({
          mode: "local",
          localWorkflowId: duplicated.id,
          hostedSlug: previous?.hostedSlug ?? null,
          lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
          pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
        }));
        recordWorkflowLastUsedAt({
          kind: "local",
          workflow: duplicated,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Impossible de dupliquer le workflow.";
        window.alert(message);
      } finally {
        setUpdatingWorkflowId(null);
        closeWorkflowMenu();
      }
    },
    [
      closeWorkflowMenu,
      duplicateWorkflowMutation,
      loadWorkflows,
      setSelectedWorkflowId,
      token,
      isAdmin,
    ],
  );

  const handleHostedWorkflowClick = useCallback(
    (slug: string) => {
      const option = hostedWorkflows.find((entry) => entry.slug === slug);
      if (!option || !option.available) {
        return;
      }

      hostedInitialAnnouncedRef.current = true;
      setSelectedHostedSlug(slug);
      updateStoredWorkflowSelection((previous) => ({
        mode: "hosted",
        localWorkflowId: previous?.localWorkflowId ?? selectedWorkflowId ?? null,
        hostedSlug: option.slug,
        lastUsedAt: previous?.lastUsedAt ?? readStoredWorkflowLastUsedMap(),
        pinned: previous?.pinned ?? createEmptyStoredWorkflowPinned(),
      }));
      onWorkflowActivatedRef.current(
        { kind: "hosted", slug: option.slug, option },
        { reason: "user" },
      );
      recordWorkflowLastUsedAt({
        kind: "hosted",
        workflow: option,
      });
      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, hostedWorkflows, isDesktopLayout, selectedWorkflowId, setSelectedHostedSlug],
  );

  const handleDeleteHostedWorkflow = useCallback(
    async (slug: string) => {
      if (!token || loading) return;

      const hosted = hostedWorkflows.find((w) => w.slug === slug);
      if (!hosted) return;

      const confirmed = window.confirm(
        `Supprimer le workflow hébergé "${hosted.label}" ? Cette action est irréversible.`,
      );
      if (!confirmed) return;

      try {
        await workflowsApi.deleteHostedWorkflow(token, slug);
        // Refresh hosted workflows list
        void loadWorkflows();
      } catch (error) {
        console.error("Failed to delete hosted workflow:", error);
        alert("Impossible de supprimer le workflow hébergé.");
      }
    },
    [token, loading, hostedWorkflows, loadWorkflows],
  );

  const handleOpenHostedAppearance = useCallback(
    (slug: string) => {
      // Navigate to workflow builder with appearance modal for hosted workflow
      navigate(`/workflow-builder?hosted=${slug}&modal=appearance`);
    },
    [navigate],
  );

  const hostedMenuItems = useCallback(
    ({ hosted, isPinned, t, onTogglePin, onCloseMenu }: {
      hosted: HostedWorkflowMetadata;
      isPinned: boolean;
      t: ReturnType<typeof useI18n>["t"];
      onTogglePin: () => void;
      onCloseMenu: () => void;
    }): WorkflowActionMenuItem[] => {
      if (!isAdmin) return [];

      const pinLabel = isPinned
        ? t("workflows.unpinAction")
        : t("workflows.pinAction");

      return [
        {
          key: "pin",
          label: pinLabel,
          onSelect: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onTogglePin();
            onCloseMenu();
          },
        },
        {
          key: "appearance",
          label: t("workflowBuilder.hostedSection.customizeAction"),
          onSelect: () => {
            onCloseMenu();
            handleOpenHostedAppearance(hosted.slug);
          },
          disabled: loading,
        },
        {
          key: "delete",
          label: t("workflowBuilder.hostedSection.deleteAction"),
          onSelect: () => {
            onCloseMenu();
            void handleDeleteHostedWorkflow(hosted.slug);
          },
          disabled: loading,
          danger: true,
        },
      ];
    },
    [isAdmin, loading, handleDeleteHostedWorkflow, handleOpenHostedAppearance],
  );

  const handleRenameWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!token || loading) return;

      const baseName = workflow.display_name?.trim() || "Workflow sans nom";
      const proposed = window.prompt("Nouveau nom du workflow ?", baseName);
      if (!proposed || proposed.trim() === baseName) return;

      const displayName = proposed.trim();
      if (!displayName) return;

      try {
        await workflowsApi.updateWorkflow(token, workflow.id, { display_name: displayName });
        // Refresh workflows list
        void loadWorkflows();
      } catch (error) {
        console.error("Failed to rename workflow:", error);
        alert("Impossible de renommer le workflow.");
      }
    },
    [token, loading, loadWorkflows],
  );

  const handleDeleteWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!token || loading) return;

      const confirmed = window.confirm(
        `Supprimer le workflow "${workflow.display_name}" ? Cette action est irréversible.`,
      );
      if (!confirmed) return;

      try {
        await workflowsApi.deleteWorkflow(token, workflow.id);
        // Refresh workflows list
        void loadWorkflows();
      } catch (error) {
        console.error("Failed to delete workflow:", error);
        alert("Impossible de supprimer le workflow.");
      }
    },
    [token, loading, loadWorkflows],
  );

  const handleExportWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!token || !workflow.active_version_id) return;

      try {
        const response = await fetch(
          `/api/workflows/${workflow.id}/versions/${workflow.active_version_id}/export`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );

        if (!response.ok) {
          throw new Error("Export failed");
        }

        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${workflow.slug || "workflow"}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error("Failed to export workflow:", error);
        alert("Impossible d'exporter le workflow.");
      }
    },
    [token],
  );

  const handleOpenAppearance = useCallback(
    (workflow: WorkflowSummary) => {
      // Navigate to workflow builder with appearance modal
      navigate(`/workflow-builder?workflow=${workflow.id}&modal=appearance`);
    },
    [navigate],
  );

  const localMenuItems = useCallback(
    ({ workflow, isPinned, t, onTogglePin, onCloseMenu }: {
      workflow: WorkflowSummary;
      isPinned: boolean;
      t: ReturnType<typeof useI18n>["t"];
      onTogglePin: () => void;
      onCloseMenu: () => void;
    }): WorkflowActionMenuItem[] => {
      if (!isAdmin) return [];

      const pinLabel = isPinned
        ? t("workflows.unpinAction")
        : t("workflows.pinAction");

      const canDelete = !loading;
      const canExport = workflow.active_version_id !== null;

      return [
        {
          key: "pin",
          label: pinLabel,
          onSelect: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onTogglePin();
            onCloseMenu();
          },
        },
        {
          key: "duplicate",
          label: t("workflowBuilder.localSection.duplicateAction"),
          onSelect: () => void handleDuplicateWorkflow(workflow),
          disabled:
            !isAdmin ||
            loading ||
            updatingWorkflowId === workflow.id ||
            workflow.active_version_id === null ||
            !token,
        },
        {
          key: "rename",
          label: t("workflowBuilder.localSection.renameAction"),
          onSelect: () => {
            onCloseMenu();
            void handleRenameWorkflow(workflow);
          },
          disabled: loading,
        },
        {
          key: "export",
          label: t("workflowBuilder.localSection.exportAction"),
          onSelect: () => {
            onCloseMenu();
            void handleExportWorkflow(workflow);
          },
          disabled: !canExport || loading,
        },
        {
          key: "appearance",
          label: t("workflowBuilder.localSection.customizeAction"),
          onSelect: () => {
            onCloseMenu();
            handleOpenAppearance(workflow);
          },
          disabled: loading,
        },
        {
          key: "delete",
          label: t("workflowBuilder.localSection.deleteAction"),
          onSelect: () => {
            onCloseMenu();
            void handleDeleteWorkflow(workflow);
          },
          disabled: !canDelete,
          danger: true,
        },
      ];
    },
    [
      handleDuplicateWorkflow,
      handleRenameWorkflow,
      handleDeleteWorkflow,
      handleExportWorkflow,
      handleOpenAppearance,
      isAdmin,
      loading,
      token,
      updatingWorkflowId,
    ],
  );

  const hostedTrailingContent = useCallback(
    (hosted: HostedWorkflowMetadata) => (
      <>
        {!hosted.available ? (
          <p className="chatkit-sidebar__workflow-meta" aria-live="polite">
            {t("workflows.hostedUnavailable")}
          </p>
        ) : null}
        {hosted.description ? (
          <p className="chatkit-sidebar__workflow-meta">{hosted.description}</p>
        ) : null}
      </>
    ),
    [t],
  );

  const sidebarEntries = useWorkflowSidebarEntries({
    workflows,
    hostedWorkflows,
    lastUsedAt,
    pinnedLookup,
    workflowCollator,
    isMobileLayout,
    selectedWorkflowId: mode === "local" ? selectedWorkflowId : null,
    selectedHostedSlug: mode === "hosted" ? selectedHostedSlug : null,
    loading,
    callbacks: {
      onHostedClick: handleHostedWorkflowClick,
      onLocalClick: handleWorkflowClick,
      onToggleHostedPin: toggleHostedPin,
      onToggleLocalPin: toggleLocalPin,
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
    hostedTrailingContent,
    sortMode,
  });

  const handleOpenBuilder = useCallback(() => {
    navigate("/workflows?create=true");
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, navigate]);

  const sidebarContent = useMemo(() => {
    const sectionId = "chat-sidebar-workflow";
    const isLtiUser = user?.is_lti ?? false;

    const sectionVariant = "overlay";

    if (!user) {
      return (
        <section
          className="chatkit-sidebar__section"
          aria-live="polite"
          data-variant={sectionVariant === "overlay" ? "overlay" : undefined}
        >
          <p className="chatkit-sidebar__section-text">
            Connectez-vous pour choisir le workflow utilisé par ChatKit.
          </p>
        </section>
      );
    }

    if (error) {
      return (
        <section
          className="chatkit-sidebar__section"
          aria-live="polite"
          data-variant={sectionVariant === "overlay" ? "overlay" : undefined}
        >
          <p className="chatkit-sidebar__section-error">{error}</p>
          <button
            type="button"
            className="chatkit-sidebar__section-button"
            onClick={() => void loadWorkflows()}
            disabled={loading}
          >
            Réessayer
          </button>
        </section>
      );
    }

    if (loading) {
      return (
        <section
          className="chatkit-sidebar__section"
          aria-live="polite"
          data-variant={sectionVariant === "overlay" ? "overlay" : undefined}
        >
          <LoadingSpinner
            size="md"
            text={isLtiUser ? 'Chargement du workflow…' : 'Chargement des workflows…'}
          />
        </section>
      );
    }

    const hasHostedWorkflow = hostedWorkflows.length > 0;
    const hasLocalWorkflows = workflows.length > 0;

    if (!hasHostedWorkflow && !hasLocalWorkflows) {
      return (
        <section
          className="chatkit-sidebar__section"
          aria-live="polite"
          data-variant={sectionVariant === "overlay" ? "overlay" : undefined}
        >
          <p className="chatkit-sidebar__section-text">
            Publiez un workflow pour qu'il soit disponible dans le chat.
          </p>
          {isAdmin ? (
            <button type="button" className="chatkit-sidebar__section-button" onClick={handleOpenBuilder}>
              Ouvrir le workflow builder
            </button>
          ) : null}
        </section>
      );
    }

    const footerContent =
      !hasLocalWorkflows && isAdmin ? (
        <button
          type="button"
          className="chatkit-sidebar__section-button"
          onClick={handleOpenBuilder}
        >
          Ouvrir le workflow builder
        </button>
      ) : null;

    const sortControl = (
      <div style={{ padding: "0 16px 8px 16px", display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setSortMode(current => current === "recent" ? "name" : "recent")}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px 8px",
            borderRadius: "4px",
          }}
          className="hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <span>Trier par : {sortMode === "recent" ? "Récent" : "Nom"}</span>
          <span style={{ fontSize: "10px" }}>{sortMode === "recent" ? "↓" : "az"}</span>
        </button>
      </div>
    );

    return (
      <WorkflowSidebarSection
        sectionId={sectionId}
        title={t("workflows.defaultSectionTitle")}
        entries={sidebarEntries}
        pinnedSectionTitle={t("workflows.pinnedSectionTitle")}
        defaultSectionTitle={t("workflows.defaultSectionTitle")}
        floatingAction={
          isAdmin
            ? {
              icon: <span aria-hidden="true">+</span>,
              label: t("workflowBuilder.createWorkflow.openModal"),
              onClick: handleOpenBuilder,
            }
            : undefined
        }
        beforeGroups={sortControl}
        footerContent={footerContent}
        variant={sectionVariant}
      />
    );
  }, [
    error,
    handleOpenBuilder,
    hostedWorkflows,
    isAdmin,
    isMobileLayout,
    loadWorkflows,
    loading,
    sidebarEntries,
    t,
    user,
    workflows,
    sortMode,
  ]);

  const collapsedSidebarContent = useMemo(() => {
    if (!user || error || loading) {
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
  }, [error, isSidebarCollapsed, loading, sidebarEntries, t, user]);

  useEffect(() => {
    // Don't render sidebar content for LTI users - they have a global loading overlay instead
    if (isLtiUser) {
      clearSidebarContent();
      return;
    }

    setSidebarContent(sidebarContent);
    setCollapsedSidebarContent(collapsedSidebarContent);
    return () => clearSidebarContent();
  }, [
    clearSidebarContent,
    collapsedSidebarContent,
    isLtiUser,
    setCollapsedSidebarContent,
    setSidebarContent,
    sidebarContent,
  ]);

  return null;
};

// ============================================================================
// WorkflowBuilderSidebar
// ============================================================================

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

export const WorkflowBuilderSidebar = ({
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
    isMobileLayout,
    closeWorkflowMenu,
    setOpenWorkflowMenuId,
    openWorkflowMenuId,
  } = useUIContext();

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
    ({
      hosted,
      isPinned,
      t,
      onTogglePin,
      onCloseMenu,
    }: {
      hosted: HostedWorkflowMetadata;
      isPinned: boolean;
      t: ReturnType<typeof useI18n>["t"];
      onTogglePin: () => void;
      onCloseMenu: () => void;
    }): WorkflowActionMenuItem[] => {
      const pinLabel = isPinned
        ? t("workflows.unpinAction")
        : t("workflows.pinAction");

      return [
        {
          key: "pin",
          label: pinLabel,
          onSelect: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onTogglePin();
            onCloseMenu();
          },
        },
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
          onSelect: () => {
            onCloseMenu();
            void onDeleteHostedWorkflow(hosted.slug);
          },
          danger: true,
        },
      ];
    },
    [onDeleteHostedWorkflow, onOpenAppearanceModal],
  );

  const localMenuItems = useCallback(
    ({
      workflow,
      isPinned,
      t,
      onTogglePin,
      onCloseMenu,
    }: {
      workflow: WorkflowSummary;
      isPinned: boolean;
      t: ReturnType<typeof useI18n>["t"];
      onTogglePin: () => void;
      onCloseMenu: () => void;
    }): WorkflowActionMenuItem[] => {
      const canDelete = !loading;
      const canDuplicate =
        !loading && (workflow.id === selectedWorkflowId || workflow.active_version_id !== null);

      const pinLabel = isPinned
        ? t("workflows.unpinAction")
        : t("workflows.pinAction");

      return [
        {
          key: "pin",
          label: pinLabel,
          onSelect: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onTogglePin();
            onCloseMenu();
          },
        },
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
          onSelect: () => {
            onCloseMenu();
            void onDeleteWorkflow(workflow.id);
          },
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
        {!workflow.active_version_id ? (
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
    const sectionVariant = "overlay";

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
