import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WorkflowSidebarSection, {
  WorkflowSidebarCompact,
  type WorkflowSidebarSectionEntry,
} from "../WorkflowSidebarSection";

describe("WorkflowSidebarSection", () => {
  it("renders pinned and default groups with floating action and footer", async () => {
    const entries: WorkflowSidebarSectionEntry[] = [
      {
        key: "hosted:alpha",
        kind: "hosted",
        isPinned: true,
        content: <div>Hosted Alpha</div>,
        compact: {
          label: "Alpha",
          initials: "AL",
          ariaLabel: "Hosted Alpha",
          disabled: true,
          isActive: false,
        },
      },
      {
        key: "local:1",
        kind: "local",
        isPinned: false,
        content: <div>Local Beta</div>,
        compact: {
          label: "Beta",
          initials: "BE",
          ariaLabel: "Local Beta",
          disabled: false,
          isActive: false,
        },
      },
    ];

    const floatingAction = { label: "Create", onClick: vi.fn(), icon: <span data-testid="add-icon">+</span> };

    render(
      <WorkflowSidebarSection
        sectionId="test-section"
        title="Workflows"
        entries={entries}
        pinnedSectionTitle="Pinned"
        defaultSectionTitle="All"
        floatingAction={floatingAction}
        footerContent={<p>Footer content</p>}
      />,
    );

    const sectionPinnedHeadings = screen.getAllByRole("heading", { name: "Pinned" });
    expect(sectionPinnedHeadings.length).toBeGreaterThan(0);
    const pinnedGroup = sectionPinnedHeadings[0].closest("[data-workflow-group='pinned']");
    expect(pinnedGroup).not.toBeNull();
    expect(within(pinnedGroup as HTMLElement).getByText("Hosted Alpha")).toBeInTheDocument();

    const defaultGroup = screen
      .getAllByRole("heading", { name: "All" })[0]
      .closest("[data-workflow-group='default']");
    expect(defaultGroup).not.toBeNull();
    expect(within(defaultGroup as HTMLElement).getByText("Local Beta")).toBeInTheDocument();

    const actionButton = screen.getByRole("button", { name: "Create" });
    expect(actionButton).toBeInTheDocument();
    expect(screen.getByTestId("add-icon")).toBeInTheDocument();

    expect(screen.getByText("Footer content")).toBeInTheDocument();
  });

  it("renders empty state when no entries are provided", () => {
    render(
      <WorkflowSidebarSection
        sectionId="empty"
        title="Workflows"
        entries={[]}
        pinnedSectionTitle="Pinned"
        defaultSectionTitle="All"
        emptyState={<p>No workflows</p>}
      />,
    );

    expect(screen.getByText("No workflows")).toBeInTheDocument();
  });
});

describe("WorkflowSidebarCompact", () => {
  it("groups compact entries by pin status", () => {
    const entries: WorkflowSidebarSectionEntry[] = [
      {
        key: "hosted:alpha",
        kind: "hosted",
        isPinned: true,
        content: <div />, // not rendered in compact
        compact: {
          label: "Alpha",
          initials: "AL",
          ariaLabel: "Alpha hosted",
          disabled: true,
          isActive: false,
          hiddenLabelSuffix: "Hosted",
        },
      },
      {
        key: "local:1",
        kind: "local",
        isPinned: false,
        content: <div />, // not rendered in compact
        compact: {
          label: "Beta",
          initials: "BE",
          ariaLabel: "Beta",
          disabled: false,
          isActive: true,
        },
      },
    ];

    render(
      <WorkflowSidebarCompact
        entries={entries}
        pinnedSectionTitle="Pinned"
        defaultSectionTitle="All"
        isSidebarCollapsed
      />,
    );

    const compactHeadings = screen.getAllByRole("heading", { name: "Pinned" });
    const compactPinnedHeading = compactHeadings[compactHeadings.length - 1];
    const pinnedGroup = compactPinnedHeading.closest("[data-workflow-group='pinned']");
    expect(pinnedGroup).not.toBeNull();
    expect(within(pinnedGroup as HTMLElement).getByRole("button", { name: "Alpha hosted" })).toBeInTheDocument();

    const compactDefaultHeadings = screen.getAllByRole("heading", { name: "All" });
    const compactDefaultHeading = compactDefaultHeadings[compactDefaultHeadings.length - 1];
    const defaultGroup = compactDefaultHeading.closest("[data-workflow-group='default']");
    expect(defaultGroup).not.toBeNull();
    expect(within(defaultGroup as HTMLElement).getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });
});
