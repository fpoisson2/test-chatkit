import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import { useI18n } from "../../i18n";
import { useAppLayout } from "../../components/AppLayout";
import { useWorkflowSidebar } from "./WorkflowSidebarProvider";
import { useEscapeKeyHandler } from "../workflow-builder/hooks/useEscapeKeyHandler";
import { useOutsidePointerDown } from "../workflow-builder/hooks/useOutsidePointerDown";
import type {
  ActionMenuPlacement,
  WorkflowActionMenuItem,
} from "./WorkflowActionMenu";
import WorkflowSidebarListItem from "./WorkflowSidebarListItem";
import { getWorkflowInitials, isWorkflowPinned, orderWorkflowEntries } from "./utils";
import type { HostedWorkflowMetadata } from "../../utils/backend";
import type { WorkflowSummary } from "../../types/workflows";

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
  onWorkflowActivated: (selection: WorkflowActivation, context: ActivationContext) => void;
};

export const ChatWorkflowSidebar = ({ onWorkflowActivated }: ChatWorkflowSidebarProps) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { closeSidebar, isDesktopLayout, isSidebarCollapsed } = useAppLayout();
  const isMobileLayout = !isDesktopLayout;
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const {
    workflows,
    hostedWorkflows,
    selectedWorkflowId,
    selectedHostedSlug,
    mode,
    loading,
    error,
    isUpdating,
    lastUsedAt,
    pinnedLookup,
    toggleLocalPin,
    toggleHostedPin,
    workflowCollatorRef,
    selectLocalWorkflow,
    selectHostedWorkflow,
    registerSidebarContent,
    registerCollapsedContent,
    clearRegisteredSidebarContent,
    loadWorkflows,
    setSelectedHostedSlug,
  } = useWorkflowSidebar();
  const hostedInitialAnnouncedRef = useRef(false);
  const onWorkflowActivatedRef = useRef(onWorkflowActivated);
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | number | null>(null);
  const [workflowMenuPlacement, setWorkflowMenuPlacement] = useState<ActionMenuPlacement>("down");
  const workflowMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onWorkflowActivatedRef.current = onWorkflowActivated;
  }, [onWorkflowActivated]);

  const closeWorkflowMenu = useCallback(() => {
    setOpenWorkflowMenuId(null);
    setWorkflowMenuPlacement("down");
    workflowMenuTriggerRef.current = null;
    workflowMenuRef.current = null;
  }, []);

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

  const handleWorkflowClick = useCallback(
    async (workflowId: number) => {
      const workflow = await selectLocalWorkflow(workflowId);
      if (!workflow) {
        return;
      }

      onWorkflowActivatedRef.current(
        { kind: "local", workflow: workflow.active_version_id ? workflow : null },
        { reason: "user" },
      );

      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, isDesktopLayout, selectLocalWorkflow],
  );

  const handleHostedWorkflowClick = useCallback(
    (slug: string) => {
      const option = selectHostedWorkflow(slug);
      if (!option) {
        return;
      }

      hostedInitialAnnouncedRef.current = true;
      onWorkflowActivatedRef.current(
        { kind: "hosted", slug: option.slug, option },
        { reason: "user" },
      );

      if (!isDesktopLayout) {
        closeSidebar();
      }
    },
    [closeSidebar, isDesktopLayout, selectHostedWorkflow],
  );

  const sortedWorkflowEntries = useMemo(() => {
    const collator =
      workflowCollatorRef.current ?? new Intl.Collator(undefined, { sensitivity: "base" });
    return orderWorkflowEntries(
      [
        ...hostedWorkflows.map((workflow) => ({ kind: "hosted" as const, workflow })),
        ...workflows.map((workflow) => ({ kind: "local" as const, workflow })),
      ],
      lastUsedAt,
      { collator, pinnedLookup },
    );
  }, [hostedWorkflows, lastUsedAt, pinnedLookup, workflows, workflowCollatorRef]);

  type CombinedEntry =
    | { kind: "hosted"; option: HostedWorkflowMetadata; isPinned: boolean }
    | { kind: "local"; workflow: WorkflowSummary; isPinned: boolean };

  const combinedEntries: CombinedEntry[] = useMemo(
    () =>
      sortedWorkflowEntries.map((entry) =>
        entry.kind === "hosted"
          ? ({
              kind: "hosted",
              option: entry.workflow,
              isPinned: isWorkflowPinned(entry, pinnedLookup),
            } satisfies CombinedEntry)
          : ({
              kind: "local",
              workflow: entry.workflow,
              isPinned: isWorkflowPinned(entry, pinnedLookup),
            } satisfies CombinedEntry),
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
    key: string | number;
    label: string;
    onClick: (() => void) | undefined;
    disabled: boolean;
    isActive: boolean;
    initials: string;
    kind: "hosted" | "local";
    isPinned: boolean;
  };

  const compactEntries: CompactEntry[] = useMemo(() => {
    const entries: CompactEntry[] = [];
    for (const entry of combinedEntries) {
      if (entry.kind === "hosted") {
        const option = entry.option;
        entries.push({
          key: `hosted:${option.slug}`,
          label: option.label,
          onClick: () => void handleHostedWorkflowClick(option.slug),
          disabled: !option.available,
          isActive: mode === "hosted" && selectedHostedSlug === option.slug,
          initials: getWorkflowInitials(option.label),
          kind: "hosted",
          isPinned: entry.isPinned,
        });
        continue;
      }

      const workflow = entry.workflow;
      entries.push({
        key: `local:${workflow.id}`,
        label: workflow.display_name,
        onClick: () => void handleWorkflowClick(workflow.id),
        disabled: workflow.active_version_id === null,
        isActive: mode === "local" && workflow.id === selectedWorkflowId,
        initials: getWorkflowInitials(workflow.display_name),
        kind: "local",
        isPinned: entry.isPinned,
      });
    }
    return entries;
  }, [combinedEntries, handleHostedWorkflowClick, handleWorkflowClick, mode, selectedHostedSlug, selectedWorkflowId]);

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

  useEffect(() => {
    if (!user) {
      hostedInitialAnnouncedRef.current = false;
      return;
    }

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
  }, [hostedWorkflows, mode, selectedHostedSlug, setSelectedHostedSlug, user]);

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
          dataAttributes={{
            "data-local-workflow": "",
            "data-selected": isActive ? "" : undefined,
          }}
          trailingContent={
            <>
              {!workflow.is_chatkit_default && !workflow.active_version_id ? (
                <p className="chatkit-sidebar__workflow-meta" aria-live="polite">
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
            onClick={() => void handleWorkflowClick(workflow.id)}
            disabled={workflow.active_version_id === null || isUpdating}
            aria-current={isActive ? "true" : undefined}
            title={workflow.description ?? undefined}
          >
            <span className="chatkit-sidebar__workflow-label">{workflow.display_name}</span>
          </button>
        </WorkflowSidebarListItem>
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
          {isAdmin ? (
            <button
              type="button"
              className="chatkit-sidebar__section-button"
              onClick={handleOpenBuilder}
            >
              {t("workflowBuilder.localSection.manageWorkflows")}
            </button>
          ) : null}
        </div>
        {pinnedCombinedEntries.length > 0 ? (
          <div className="chatkit-sidebar__workflow-group chatkit-sidebar__workflow-group--pinned">
            <h3 className="chatkit-sidebar__workflow-group-title">
              {t("workflows.pinnedSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
              {pinnedCombinedEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
        ) : null}
        {regularCombinedEntries.length > 0 ? (
          <div className="chatkit-sidebar__workflow-group" data-workflow-group="default">
            <h3 className="chatkit-sidebar__workflow-group-title">
              {t("workflows.defaultSectionTitle")}
            </h3>
            <ul className="chatkit-sidebar__workflow-list chatkit-sidebar__workflow-list--grouped">
              {regularCombinedEntries.map((entry) => renderEntry(entry))}
            </ul>
          </div>
        ) : null}
      </section>
    );
  }, [
    error,
    handleHostedWorkflowClick,
    handleOpenBuilder,
    handleWorkflowClick,
    hostedWorkflows,
    isAdmin,
    isDesktopLayout,
    isMobileLayout,
    isUpdating,
    loadWorkflows,
    loading,
    mode,
    openWorkflowMenuId,
    pinnedCombinedEntries,
    regularCombinedEntries,
    selectedHostedSlug,
    selectedWorkflowId,
    t,
    toggleHostedPin,
    toggleLocalPin,
    isAdmin,
    user,
    workflows,
    workflowMenuPlacement,
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
          <div className="chatkit-sidebar__workflow-compact-group" data-workflow-group="default">
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
    const cleanupMain = registerSidebarContent(sidebarContent);
    const cleanupCollapsed = registerCollapsedContent(collapsedSidebarContent);
    return () => {
      cleanupMain();
      cleanupCollapsed();
      clearRegisteredSidebarContent();
    };
  }, [
    clearRegisteredSidebarContent,
    collapsedSidebarContent,
    registerCollapsedContent,
    registerSidebarContent,
    sidebarContent,
  ]);

  return null;
};

