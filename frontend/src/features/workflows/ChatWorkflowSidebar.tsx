import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
  ActionMenuPlacement,
  WorkflowActionMenuItem,
} from "./WorkflowActionMenu";
import WorkflowSidebarSection, {
  WorkflowSidebarCompact,
  type WorkflowSidebarSectionEntry,
} from "./WorkflowSidebarSection";
import {
  getWorkflowInitials,
  isWorkflowPinned,
  orderWorkflowEntries,
  recordWorkflowLastUsedAt,
  readStoredWorkflowLastUsedMap,
  createEmptyStoredWorkflowPinned,
  updateStoredWorkflowSelection,
} from "./utils";
import { useWorkflowSidebar } from "./WorkflowSidebarProvider";

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
  const isLtiUser = Boolean(user?.email.endsWith('@lti.local'));

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
    if (!user.email.endsWith('@lti.local')) {
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

      const isLtiUser = user?.email.endsWith('@lti.local');

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
      recordWorkflowLastUsedAt,
      setSelectedWorkflowId,
      token,
      isAdmin,
      updateStoredWorkflowSelection,
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

  const sidebarEntries = useMemo<WorkflowSidebarSectionEntry[]>(
    () =>
      sortedWorkflowEntries.map((entry) => {
        if (entry.kind === "hosted") {
          const option = entry.workflow;
          const isPinned = isWorkflowPinned(entry, pinnedLookup);
          const isSelected = mode === "hosted" && selectedHostedSlug === option.slug;
          const menuKey = `hosted:${option.slug}`;
          const isMenuOpen = openWorkflowMenuId === menuKey;
          const menuId = `workflow-actions-${option.slug}`;
          const pinLabel = isPinned
            ? t("workflows.unpinAction", { label: option.label })
            : t("workflows.pinAction", { label: option.label });
          const hostedMenuItems: WorkflowActionMenuItem[] = [
            {
              key: "pin",
              label: pinLabel,
              onSelect: (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleHostedPin(option.slug);
                closeWorkflowMenu();
              },
            },
            {
              key: "appearance",
              label: t("workflowBuilder.hostedSection.customizeAction"),
              disabled: true,
            },
            {
              key: "delete",
              label: t("workflowBuilder.hostedSection.deleteAction"),
              disabled: true,
              danger: true,
            },
          ];

          return {
            key: `hosted:${option.slug}`,
            kind: "hosted" as const,
            isPinned,
            pinLabel,
            onTogglePin: (event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleHostedPin(option.slug);
            },
            menuProps: isAdmin
              ? {
                  menuId,
                  isOpen: isMenuOpen,
                  isMobileLayout,
                  placement: isMenuOpen ? workflowMenuPlacement : "down",
                  triggerDisabled: loading,
                  triggerLabel: t("workflowBuilder.hostedSection.openActions", {
                    label: option.label,
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
                }
              : null,
            hasActions: isAdmin,
            dataAttributes: { "data-hosted-workflow": "" },
            trailingContent: (
              <>
                {!option.available ? (
                  <p className="chatkit-sidebar__workflow-meta" aria-live="polite">
                    {t("workflows.hostedUnavailable")}
                  </p>
                ) : null}
                {option.description ? (
                  <p className="chatkit-sidebar__workflow-meta">{option.description}</p>
                ) : null}
              </>
            ),
            content: (
              <button
                type="button"
                className={`chatkit-sidebar__workflow-button chatkit-sidebar__workflow-button--hosted${
                  isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""
                }`}
                onClick={() => void handleHostedWorkflowClick(option.slug)}
                disabled={!option.available}
                aria-current={isSelected ? "true" : undefined}
                title={option.description ?? t("workflows.hostedBadge")}
              >
                <span className="chatkit-sidebar__workflow-label">{option.label}</span>
                <span className="chatkit-sidebar__workflow-badge chatkit-sidebar__workflow-badge--hosted">
                  {t("workflows.hostedBadge")}
                </span>
              </button>
            ),
            compact: {
              label: option.label,
              initials: getWorkflowInitials(option.label),
              onClick: () => void handleHostedWorkflowClick(option.slug),
              disabled: !option.available,
              isActive: isSelected,
              ariaLabel: t("workflows.hostedCompactLabel", { label: option.label }),
              hiddenLabelSuffix: t("workflows.hostedBadge"),
            },
          } satisfies WorkflowSidebarSectionEntry;
        }

        const workflow = entry.workflow;
        const isPinned = isWorkflowPinned(entry, pinnedLookup);
        const isActive = mode === "local" && workflow.id === selectedWorkflowId;
        const hasProduction = workflow.active_version_id !== null;
        const menuId = `workflow-actions-${workflow.id}`;
        const isMenuOpen = openWorkflowMenuId === workflow.id;
        const pinLabel = isPinned
          ? t("workflows.unpinAction", { label: workflow.display_name })
          : t("workflows.pinAction", { label: workflow.display_name });
        const localMenuItems: WorkflowActionMenuItem[] = [
          {
            key: "pin",
            label: pinLabel,
            onSelect: (event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleLocalPin(workflow.id);
              closeWorkflowMenu();
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
            disabled: true,
          },
          {
            key: "export",
            label: t("workflowBuilder.localSection.exportAction"),
            disabled: true,
          },
          {
            key: "appearance",
            label: t("workflowBuilder.localSection.customizeAction"),
            disabled: true,
          },
          {
            key: "delete",
            label: t("workflowBuilder.localSection.deleteAction"),
            disabled: true,
            danger: true,
          },
        ];

        return {
          key: `local:${workflow.id}`,
          kind: "local" as const,
          isPinned,
          pinLabel,
          onTogglePin: (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleLocalPin(workflow.id);
          },
          menuProps: isAdmin
            ? {
                menuId,
                isOpen: isMenuOpen,
                isMobileLayout,
                placement: isMenuOpen ? workflowMenuPlacement : "down",
                triggerDisabled: loading || updatingWorkflowId === workflow.id,
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
              }
            : null,
          hasActions: isAdmin,
          content: (
            <button
              type="button"
              className={`chatkit-sidebar__workflow-button${
                isPinned ? " chatkit-sidebar__workflow-button--pinned" : ""
              }`}
              onClick={() => void handleWorkflowClick(workflow.id)}
              disabled={!hasProduction}
              aria-current={isActive ? "true" : undefined}
            >
              <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
            </button>
          ),
          compact: {
            label: workflow.display_name,
            initials: getWorkflowInitials(workflow.display_name),
            onClick: () => void handleWorkflowClick(workflow.id),
            disabled: !hasProduction,
            isActive,
            ariaLabel: workflow.display_name,
          },
        } satisfies WorkflowSidebarSectionEntry;
      }),
    [
      closeWorkflowMenu,
      handleDuplicateWorkflow,
      handleHostedWorkflowClick,
      handleWorkflowClick,
      isAdmin,
      isMobileLayout,
      updatingWorkflowId,
      loading,
      mode,
      openWorkflowMenuId,
      pinnedLookup,
      selectedHostedSlug,
      selectedWorkflowId,
      setOpenWorkflowMenuId,
      setWorkflowMenuPlacement,
      sortedWorkflowEntries,
      t,
      toggleHostedPin,
      toggleLocalPin,
      token,
      workflowMenuPlacement,
      workflowMenuRef,
      workflowMenuTriggerRef,
    ],
  );

  const handleOpenBuilder = useCallback(() => {
    navigate("/workflows");
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, navigate]);

  const sidebarContent = useMemo(() => {
    const sectionId = "chat-sidebar-workflow";
    const isLtiUser = user?.email.endsWith('@lti.local') ?? false;

    const sectionVariant = isMobileLayout ? "overlay" : "default";

    if (!user) {
      return (
        <section
          className="chatkit-sidebar__section"
          aria-live="polite"
          data-variant={sectionVariant === "overlay" ? "overlay" : undefined}
        >
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
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
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
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
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
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
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
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
