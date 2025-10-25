import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

import { ChatWorkflowSidebar } from "../ChatWorkflowSidebar";

const useAuthMock = vi.fn();
const closeSidebarMock = vi.fn();
const workflowsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  setChatkitWorkflow: vi.fn(),
}));

const navigateMock = vi.fn();
let sidebarContent: ReactNode | null = null;
const setSidebarContentMock = vi.fn((node: ReactNode) => {
  sidebarContent = node;
});
const clearSidebarContentMock = vi.fn(() => {
  sidebarContent = null;
});

vi.mock("../../../auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../../../components/AppLayout", () => ({
  useAppLayout: () => ({
    closeSidebar: closeSidebarMock,
    isDesktopLayout: true,
  }),
  useSidebarPortal: () => ({
    setSidebarContent: setSidebarContentMock,
    clearSidebarContent: clearSidebarContentMock,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === "chat.sidebar.hostedWorkflow.label" ? "Hosted workflow (OpenAI)" : key,
  }),
}));

vi.mock("../../../utils/backend", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/backend")>(
    "../../../utils/backend",
  );
  return {
    ...actual,
    workflowsApi: {
      ...actual.workflowsApi,
      list: workflowsApiMock.list,
      setChatkitWorkflow: workflowsApiMock.setChatkitWorkflow,
    },
  };
});

const renderSidebarContent = () => {
  if (!sidebarContent) {
    throw new Error("Sidebar content not initialised");
  }

  return render(<>{sidebarContent}</>);
};

describe("ChatWorkflowSidebar", () => {
  beforeEach(() => {
    sidebarContent = null;
    setSidebarContentMock.mockClear();
    clearSidebarContentMock.mockClear();
    closeSidebarMock.mockClear();
    navigateMock.mockClear();
    workflowsApiMock.list.mockReset();
    workflowsApiMock.setChatkitWorkflow.mockReset();
    useAuthMock.mockReturnValue({
      token: "token",
      user: { id: 1, email: "admin@example.com", is_admin: true },
    });
  });

  it("renders the hosted workflow option alongside local workflows", async () => {
    workflowsApiMock.list.mockResolvedValue([
      {
        id: 42,
        slug: "local-flow",
        display_name: "Local workflow",
        description: null,
        active_version_id: 101,
        active_version_number: 1,
        is_chatkit_default: true,
        versions_count: 1,
        created_at: "2024-07-01T10:00:00Z",
        updated_at: "2024-07-01T10:00:00Z",
      },
    ]);

    const onWorkflowActivated = vi.fn();

    render(
      <ChatWorkflowSidebar hostedFlowEnabled={false} onWorkflowActivated={onWorkflowActivated} />,
    );

    await waitFor(() => expect(workflowsApiMock.list).toHaveBeenCalled());
    await waitFor(() => expect(sidebarContent).not.toBeNull());

    const { getByRole } = renderSidebarContent();

    expect(getByRole("button", { name: "Hosted workflow (OpenAI)" })).toBeInTheDocument();
    expect(getByRole("button", { name: "Local workflow" })).toBeInTheDocument();
  });

  it("activates the hosted workflow when selected", async () => {
    workflowsApiMock.list.mockResolvedValue([
      {
        id: 7,
        slug: "local",
        display_name: "Local option",
        description: null,
        active_version_id: 21,
        active_version_number: 1,
        is_chatkit_default: true,
        versions_count: 1,
        created_at: "2024-07-01T10:00:00Z",
        updated_at: "2024-07-01T10:00:00Z",
      },
    ]);

    const onWorkflowActivated = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatWorkflowSidebar hostedFlowEnabled={false} onWorkflowActivated={onWorkflowActivated} />,
    );

    await waitFor(() => expect(workflowsApiMock.list).toHaveBeenCalled());
    await waitFor(() => expect(sidebarContent).not.toBeNull());

    const { getByRole, rerender } = renderSidebarContent();

    await user.click(getByRole("button", { name: "Hosted workflow (OpenAI)" }));

    const lastCall = onWorkflowActivated.mock.calls.at(-1);
    expect(lastCall).toEqual([
      null,
      {
        reason: "user",
        mode: "hosted",
      },
    ]);

    rerender(<>{sidebarContent}</>);
    expect(getByRole("button", { name: "Hosted workflow (OpenAI)" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
