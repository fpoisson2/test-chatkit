import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactElement, ReactNode } from "react";

import { I18nProvider } from "../../../i18n";
import { DocDetail } from "../DocDetail";
import { DocsPage } from "../DocsPage";

const useAuthMock = vi.fn();
const docsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../../auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../../../components/AppLayout", () => ({
  useAppLayout: () => ({
    openSidebar: vi.fn(),
    closeSidebar: vi.fn(),
    openSettings: vi.fn(),
    isDesktopLayout: true,
    isSidebarOpen: true,
    isSidebarCollapsed: false,
    isSidebarAutoCloseLocked: false,
    releaseSidebarAutoCloseLock: vi.fn(),
  }),
  useSidebarPortal: () => ({
    setSidebarContent: vi.fn(),
    clearSidebarContent: vi.fn(),
    setCollapsedSidebarContent: vi.fn(),
    clearCollapsedSidebarContent: vi.fn(),
  }),
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../../utils/backend", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/backend")>(
    "../../../utils/backend",
  );
  return {
    ...actual,
    docsApi: docsApiMock,
  };
});

const renderWithProviders = (ui: ReactElement, initialEntries: string[] = ["/docs"]) =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </I18nProvider>,
  );

describe("docs pages", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({
      token: "token",
      user: { id: 1, email: "user@example.com", is_admin: true },
      logout: vi.fn(),
    });
    Object.values(docsApiMock).forEach((mockFn) => mockFn.mockReset());
  });

  it("shows a loading state while fetching the documentation list", () => {
    docsApiMock.list.mockReturnValue(new Promise(() => {}));

    renderWithProviders(
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
      </Routes>,
    );

    expect(screen.getByText("Loading documentation…")).toBeInTheDocument();
  });

  it("navigates from the list to the document detail page", async () => {
    docsApiMock.list.mockResolvedValue([
      {
        slug: "getting-started",
        title: "Getting started",
        summary: "Welcome",
        language: "en",
        created_at: "2024-05-01T10:00:00Z",
        updated_at: "2024-05-02T10:00:00Z",
      },
    ]);
    docsApiMock.get.mockResolvedValue({
      slug: "getting-started",
      title: "Getting started",
      summary: "Welcome",
      language: "en",
      created_at: "2024-05-01T10:00:00Z",
      updated_at: "2024-05-02T10:00:00Z",
      content_markdown: "# Hello world",
      metadata: {},
    });

    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:slug" element={<DocDetail />} />
      </Routes>,
    );

    expect(await screen.findByRole("heading", { name: "Getting started" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Open" }));

    await waitFor(() => {
      expect(docsApiMock.get).toHaveBeenCalledWith("token", "getting-started");
    });

    expect(await screen.findByText("← Back to docs")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hello world" })).toBeInTheDocument();
  });

  it("renders edit controls for administrators", async () => {
    docsApiMock.get.mockResolvedValue({
      slug: "policy",
      title: "Policy",
      summary: null,
      language: "en",
      created_at: "2024-05-01T10:00:00Z",
      updated_at: "2024-05-02T10:00:00Z",
      content_markdown: "Content",
      metadata: {},
    });

    renderWithProviders(
      <Routes>
        <Route path="/docs/:slug" element={<DocDetail />} />
      </Routes>,
      ["/docs/policy"],
    );

    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("hides edit controls for regular users", async () => {
    useAuthMock.mockReturnValue({
      token: "token",
      user: { id: 2, email: "user@site.com", is_admin: false },
      logout: vi.fn(),
    });

    docsApiMock.get.mockResolvedValue({
      slug: "policy",
      title: "Policy",
      summary: null,
      language: "en",
      created_at: "2024-05-01T10:00:00Z",
      updated_at: "2024-05-02T10:00:00Z",
      content_markdown: "Content",
      metadata: {},
    });

    renderWithProviders(
      <Routes>
        <Route path="/docs/:slug" element={<DocDetail />} />
      </Routes>,
      ["/docs/policy"],
    );

    await screen.findByText("← Back to docs");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
