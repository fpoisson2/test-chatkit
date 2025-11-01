import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { I18nProvider } from "../../../i18n";
import { WORKFLOW_SELECTION_STORAGE_KEY } from "../utils";
import type { HostedWorkflowMetadata } from "../../../utils/backend";
import type { WorkflowSummary } from "../../../types/workflows";
import { chatkitApi, workflowsApi } from "../../../utils/backend";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

let latestSidebarContent: ReactNode | null = null;
const setSidebarContentMock = vi.fn((content: ReactNode | null) => {
  latestSidebarContent = content;
});
const clearSidebarContentMock = vi.fn(() => {
  latestSidebarContent = null;
});

vi.mock("../../../components/AppLayout", () => ({
  useAppLayout: () => ({
    closeSidebar: vi.fn(),
    isDesktopLayout: true,
    isSidebarCollapsed: false,
  }),
  useSidebarPortal: () => ({
    setSidebarContent: setSidebarContentMock,
    setCollapsedSidebarContent: vi.fn(),
    clearSidebarContent: clearSidebarContentMock,
    clearCollapsedSidebarContent: vi.fn(),
  }),
}));

let ChatWorkflowSidebar: typeof import("../ChatWorkflowSidebar").ChatWorkflowSidebar;

beforeAll(async () => {
  ({ ChatWorkflowSidebar } = await import("../ChatWorkflowSidebar"));
});

vi.mock("../../../auth", () => ({
  useAuth: () => ({
    token: "token",
    user: { is_admin: true },
  }),
}));


const renderSidebarHost = async () => {
  await waitFor(() => {
    expect(setSidebarContentMock).toHaveBeenCalled();
    expect(latestSidebarContent).not.toBeNull();
  });

  return render(<I18nProvider>{latestSidebarContent}</I18nProvider>);
};

const createWorkflow = (id: number, name: string): WorkflowSummary => ({
  id,
  slug: `workflow-${id}`,
  display_name: name,
  description: null,
  active_version_id: 1,
  active_version_number: 1,
  is_chatkit_default: false,
  versions_count: 1,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
});

const createHosted = (slug: string, label: string): HostedWorkflowMetadata => ({
  id: slug,
  slug,
  label,
  description: null,
  available: true,
  managed: true,
});

describe("ChatWorkflowSidebar pinning", () => {
  beforeEach(() => {
    latestSidebarContent = null;
    setSidebarContentMock.mockClear();
    clearSidebarContentMock.mockClear();
    window.sessionStorage.clear();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      configurable: true,
    });

    vi.spyOn(workflowsApi, "list").mockResolvedValue([
      createWorkflow(1, "Alpha"),
      createWorkflow(2, "Beta"),
    ]);
    vi.spyOn(chatkitApi, "getHostedWorkflows").mockResolvedValue([
      createHosted("gamma", "Gamma"),
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    // Reset localStorage stub
    // @ts-expect-error test cleanup
    delete window.localStorage;
    latestSidebarContent = null;
  });

  it("pins workflows and persists the preference", async () => {
    const user = userEvent.setup();
    const { unmount: unmountSidebar } = render(
      <I18nProvider>
        <ChatWorkflowSidebar mode="local" setMode={vi.fn()} onWorkflowActivated={vi.fn()} />
      </I18nProvider>,
    );

    const sidebarHost = await renderSidebarHost();
    await waitFor(() => {
      sidebarHost.rerender(<I18nProvider>{latestSidebarContent}</I18nProvider>);
      expect(sidebarHost.getByRole("list")).toBeInTheDocument();
    });

    const list = sidebarHost.getByRole("list");
    let items = within(list).getAllByRole("listitem");
    expect(within(items[0]).getByText("Alpha")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pin Beta" }));

    await waitFor(() => {
      const stored = window.sessionStorage.getItem(WORKFLOW_SELECTION_STORAGE_KEY);
      expect(stored).toContain("\"local\":[2]");
    });

    sidebarHost.rerender(<I18nProvider>{latestSidebarContent}</I18nProvider>);
    items = within(sidebarHost.getByRole("list")).getAllByRole("listitem");
    expect(within(items[0]).getByText("Beta")).toBeInTheDocument();
    expect(sidebarHost.getByRole("button", { name: "Unpin Beta" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    unmountSidebar();
    sidebarHost.unmount();
    setSidebarContentMock.mockClear();

    const rerendered = render(
      <I18nProvider>
        <ChatWorkflowSidebar mode="local" setMode={vi.fn()} onWorkflowActivated={vi.fn()} />
      </I18nProvider>,
    );

    const rerenderedHost = await renderSidebarHost();
    await waitFor(() => {
      rerenderedHost.rerender(<I18nProvider>{latestSidebarContent}</I18nProvider>);
      expect(rerenderedHost.getByRole("list")).toBeInTheDocument();
    });

    const rerenderedItems = within(rerenderedHost.getByRole("list")).getAllByRole("listitem");
    expect(within(rerenderedItems[0]).getByText("Beta")).toBeInTheDocument();
    expect(rerenderedHost.getByRole("button", { name: "Unpin Beta" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    rerendered.unmount();
    rerenderedHost.unmount();
  });
});
