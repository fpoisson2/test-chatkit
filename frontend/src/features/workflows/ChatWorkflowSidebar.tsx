import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout, useSidebarPortal } from "../../components/AppLayout";
import { workflowsApi } from "../../utils/backend";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";
import { useEscapeKeyHandler } from "../workflow-builder/hooks/useEscapeKeyHandler";
import { useOutsidePointerDown } from "../workflow-builder/hooks/useOutsidePointerDown";
import type {
  ActionMenuPlacement,
  WorkflowActionMenuItem,
} from "./WorkflowActionMenu";
import WorkflowSidebarListItem from "./WorkflowSidebarListItem";
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

  const [isUpdating, setIsUpdating] = useState(false);
  const hostedInitialAnnouncedRef = useRef(false);
  const onWorkflowActivatedRef = useRef(onWorkflowActivated);
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);
  const [workflowMenuPlacement, setWorkflowMenuPlacement] = useState<ActionMenuPlacement>("down");
  const workflowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);

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
  const hasAnnouncedInitialLocal = useRef(false);
  useEffect(() => {
    if (hasAnnouncedInitialLocal.current || mode !== "local" || !workflows.length) {
      return;
    }

    const workflow = workflows.find((w) => w.id === selectedWorkflowId) ?? null;
    hasAnnouncedInitialLocal.current = true;
    onWorkflowActivatedRef.current(
      { kind: "local", workflow },
      { reason: "initial" },
    );
  }, [mode, selectedWorkflowId, workflows]);

  const handleWorkflowClick = useCallback(
    async (workflowId: number) => {
      if (!token || !isAdmin || workflowId === selectedWorkflowId || isUpdating) {
        return;
      }

      const workflowToActivate = workflows.find((workflow) => workflow.id === workflowId);
      if (!workflowToActivate || workflowToActivate.active_version_id === null) {
        return;
      }

      setIsUpdating(true);
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
        setIsUpdating(false);
      }
    },
    [
      closeSidebar,
      isAdmin,
      isDesktopLayout,
      isUpdating,
      selectedWorkflowId,
      setSelectedWorkflowId,
      setWorkflows,
      token,
      workflows,
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

  type CombinedEntry =
    | { kind: "hosted"; option: HostedWorkflowMetadata; isPinned: boolean }
    | { kind: "local"; workflow: WorkflowSummary; isPinned: boolean };

  const combinedEntries: CombinedEntry[] = useMemo(
    () =>
      sortedWorkflowEntries.map((entry) =>
        entry.kind === "hosted"
          ? ({
              kind: "hosted" as const,
              option: entry.workflow,
              isPinned: isWorkflowPinned(entry, pinnedLookup),
            })
          : ({
              kind: "local" as const,
              workflow: entry.workflow,
              isPinned: isWorkflowPinned(entry, pinnedLookup),
            })
      ),
    [pinnedLookup, sortedWorkflowEntries],
  );

  const { pinnedCombinedEntries, regularCombinedEntries } = useMemo(() => {
    const pinned: CombinedEntry[] = [];
    const regular: CombinedEntry[] = [];
    for (const entry of combinedEntries) {
      if (entry.isPinned) {
        pinned.push(entry);
      } else {
        regular.push(entry);
      }
    }
    return { pinnedCombinedEntries: pinned, regularCombinedEntries: regular };
  }, [combinedEntries]);

  type CompactEntry = {
    key: string;
    label: string;
    onClick: () => void;
    disabled: boolean;
    isActive: boolean;
    initials: string;
    kind: "hosted" | "local";
    isPinned: boolean;
  };

  const compactEntries: CompactEntry[] = useMemo(
    () =>
      combinedEntries.map((entry) => {
        if (entry.kind === "hosted") {
          const option = entry.option;
          return {
            key: `hosted:${option.slug}`,
            label: option.label,
            onClick: () => void handleHostedWorkflowClick(option.slug),
            disabled: !option.available,
            isActive: mode === "hosted" && selectedHostedSlug === option.slug,
            initials: getWorkflowInitials(option.label),
            kind: "hosted" as const,
            isPinned: entry.isPinned,
          };
        }

        const workflow = entry.workflow;
        return {
          key: `local:${workflow.id}`,
          label: workflow.display_name,
          onClick: () => void handleWorkflowClick(workflow.id),
          disabled: workflow.active_version_id === null,
          isActive: mode === "local" && workflow.id === selectedWorkflowId,
          initials: getWorkflowInitials(workflow.display_name),
          kind: "local" as const,
          isPinned: entry.isPinned,
        };
      }),
    [
      combinedEntries,
      handleHostedWorkflowClick,
      handleWorkflowClick,
      mode,
      selectedHostedSlug,
      selectedWorkflowId,
    ],
  );

  const { pinnedCompactEntries, regularCompactEntries } = useMemo(() => {
    const pinned: CompactEntry[] = [];
    const regular: CompactEntry[] = [];
    for (const entry of compactEntries) {
      if (entry.isPinned) {
        pinned.push(entry);
      } else {
        regular.push(entry);
      }
    }
    return { pinnedCompactEntries: pinned, regularCompactEntries: regular };
  }, [compactEntries]);

  const handleOpenBuilder = useCallback(() => {
    navigate("/workflows");
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout, navigate]);

  const sidebarContent = useMemo(() => {
    const sectionId = "chat-sidebar-workflow";

    if (!user) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-text">
            Connectez-vous pour choisir le workflow utilisé par ChatKit.
          </p>
        </section>
      );
    }

    if (error) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
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
        <section className="chatkit-sidebar__section" aria-live="polite">
          <h2 className="chatkit-sidebar__section-title">Workflow</h2>
          <p className="chatkit-sidebar__section-text">Chargement des workflows…</p>
        </section>
      );
    }

    const hasHostedWorkflow = hostedWorkflows.length > 0;
    const hasLocalWorkflows = workflows.length > 0;

    if (!hasHostedWorkflow && !hasLocalWorkflows) {
      return (
        <section className="chatkit-sidebar__section" aria-live="polite">
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

    const renderEntry = (entry: CombinedEntry) => {
      if (entry.kind === "hosted") {
        const { option, isPinned } = entry;
        const isSelected = mode === "hosted" && selectedHostedSlug === option.slug;
        const menuKey = `hosted:${option.slug}`;
        const isMenuOpen = openWorkflowMenuId === menuKey;
        const menuId = `workflow-actions-${option.slug}`;
        const pinLabel = isPinned
          ? t("workflows.unpinAction", { label: option.label })
          : t("workflows.pinAction", { label: option.label });
        const hostedMenuItems: WorkflowActionMenuItem[] = [
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
        return (
          <WorkflowSidebarListItem
            key={`hosted:${option.slug}`}
            isPinned={isPinned}
            pinLabel={pinLabel}
            onTogglePin={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleHostedPin(option.slug);
            }}
            menuProps={
              isAdmin
                ? {
                    menuId,
                    isOpen: isMenuOpen,
                    isMobileLayout,
                    placement: isMenuOpen ? workflowMenuPlacement : "down",
                    triggerDisabled: loading || isUpdating,
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
                  }
                : null
            }
            hasActions={isAdmin}
            dataAttributes={{ "data-hosted-workflow": "" }}
            trailingContent={
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
            }
          >
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
          </WorkflowSidebarListItem>
        );
      }

      const { workflow, isPinned } = entry;
      const isActive = mode === "local" && workflow.id === selectedWorkflowId;
      const hasProduction = workflow.active_version_id !== null;
      const menuId = `workflow-actions-${workflow.id}`;
      const isMenuOpen = openWorkflowMenuId === workflow.id;
      const pinLabel = isPinned
        ? t("workflows.unpinAction", { label: workflow.display_name })
        : t("workflows.pinAction", { label: workflow.display_name });
      const localMenuItems: WorkflowActionMenuItem[] = [
        {
          key: "duplicate",
          label: t("workflowBuilder.localSection.duplicateAction"),
          disabled: true,
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
      return (
        <WorkflowSidebarListItem
          key={`local:${workflow.id}`}
          isPinned={isPinned}
          pinLabel={pinLabel}
          onTogglePin={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleLocalPin(workflow.id);
          }}
          menuProps={
            isAdmin
              ? {
                  menuId,
                  isOpen: isMenuOpen,
                  isMobileLayout,
                  placement: isMenuOpen ? workflowMenuPlacement : "down",
                  triggerDisabled: loading || isUpdating,
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
          hasActions={isAdmin}
        >
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
        </WorkflowSidebarListItem>
      );
    };

    const sectionClassName = isAdmin
      ? "chatkit-sidebar__section chatkit-sidebar__section--with-floating-action"
      : "chatkit-sidebar__section";

    return (
      <section className={sectionClassName} aria-labelledby={`${sectionId}-title`}>
        <h2 id={`${sectionId}-title`} className="visually-hidden">
          {t("workflows.defaultSectionTitle")}
        </h2>
        {isAdmin ? (
          <div className="chatkit-sidebar__section-floating-action">
            <button
              type="button"
              className="chatkit-sidebar__section-icon-button"
              onClick={handleOpenBuilder}
              aria-label={t("workflowBuilder.createWorkflow.openModal")}
              title={t("workflowBuilder.createWorkflow.openModal")}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        ) : null}
        {pinnedCombinedEntries.length > 0 ? (
          <div
            className="chatkit-sidebar__workflow-group chatkit-sidebar__workflow-group--pinned"
            data-workflow-group="pinned"
          >
            <h3 className="chatkit-sidebar__workflow-group-title">
              {t("workflows.pinnedSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
              {pinnedCombinedEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
        ) : null}
        {regularCombinedEntries.length > 0 ? (
          <div
            className="chatkit-sidebar__workflow-group"
            data-workflow-group="default"
          >
            <h3 className="chatkit-sidebar__workflow-group-title">
              {t("workflows.defaultSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
              {regularCombinedEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
        ) : null}
        {!hasLocalWorkflows && isAdmin ? (
          <button
            type="button"
            className="chatkit-sidebar__section-button"
            onClick={handleOpenBuilder}
          >
            Ouvrir le workflow builder
          </button>
        ) : null}
      </section>
    );
  }, [
    error,
    handleOpenBuilder,
    handleHostedWorkflowClick,
    handleWorkflowClick,
    closeWorkflowMenu,
    hostedWorkflows,
    isAdmin,
    isMobileLayout,
    isUpdating,
    loadWorkflows,
    loading,
    mode,
    openWorkflowMenuId,
    pinnedCombinedEntries,
    regularCombinedEntries,
    workflowMenuPlacement,
    toggleHostedPin,
    toggleLocalPin,
    selectedHostedSlug,
    selectedWorkflowId,
    t,
    user,
    workflows,
  ]);

  const collapsedSidebarContent = useMemo(() => {
    if (!user || error || loading || compactEntries.length === 0) {
      return null;
    }

    const renderCompactEntry = (entry: CompactEntry) => (
      <li
        key={entry.key}
        className="chatkit-sidebar__workflow-compact-item"
        data-pinned={entry.isPinned ? "" : undefined}
      >
        <button
          type="button"
          className={`chatkit-sidebar__workflow-compact-button${
            entry.isActive ? " chatkit-sidebar__workflow-compact-button--active" : ""
          }${entry.kind === "hosted" ? " chatkit-sidebar__workflow-compact-button--hosted" : ""}${
            entry.isPinned ? " chatkit-sidebar__workflow-compact-button--pinned" : ""
          }`}
          onClick={entry.onClick}
          disabled={entry.disabled}
          aria-current={entry.isActive ? "true" : undefined}
          tabIndex={isSidebarCollapsed ? 0 : -1}
          aria-label={
            entry.kind === "hosted"
              ? t("workflows.hostedCompactLabel", { label: entry.label })
              : entry.label
          }
        >
          <span aria-hidden="true" className="chatkit-sidebar__workflow-compact-initial">
            {entry.initials}
          </span>
          <span className="visually-hidden">
            {entry.label}
            {entry.kind === "hosted" ? ` (${t("workflows.hostedBadge")})` : ""}
          </span>
        </button>
      </li>
    );

    return (
      <div className="chatkit-sidebar__workflow-compact-groups">
        {pinnedCompactEntries.length > 0 ? (
          <div
            className="chatkit-sidebar__workflow-compact-group chatkit-sidebar__workflow-compact-group--pinned"
            data-workflow-group="pinned"
          >
            <h3 className="chatkit-sidebar__workflow-compact-group-title">
              {t("workflows.pinnedSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-compact-list chatkit-sidebar__workflow-compact-list--grouped">
              {pinnedCompactEntries.map((entry) => renderCompactEntry(entry))}
            </ul>
          </div>
        ) : null}
        {regularCompactEntries.length > 0 ? (
          <div
            className="chatkit-sidebar__workflow-compact-group"
            data-workflow-group="default"
          >
            <h3 className="chatkit-sidebar__workflow-compact-group-title">
              {t("workflows.defaultSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-compact-list">
              {regularCompactEntries.map((entry) => renderCompactEntry(entry))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }, [
    compactEntries,
    error,
    isSidebarCollapsed,
    loading,
    pinnedCompactEntries,
    regularCompactEntries,
    t,
    user,
  ]);

  useEffect(() => {
    setSidebarContent(sidebarContent);
    setCollapsedSidebarContent(collapsedSidebarContent);
    return () => clearSidebarContent();
  }, [
    clearSidebarContent,
    collapsedSidebarContent,
    setCollapsedSidebarContent,
    setSidebarContent,
    sidebarContent,
  ]);

  return null;
};
