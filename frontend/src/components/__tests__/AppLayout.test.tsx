import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppLayout, useAppLayout } from "../AppLayout";

vi.mock("../../auth", () => ({
  useAuth: () => ({
    user: { email: "user@example.com", is_admin: false },
    logout: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../hooks/useDesktopLayout", () => ({
  useIsDesktopLayout: () => true,
  getDesktopLayoutPreference: () => false,
}));

const SidebarControls = () => {
  const { openSidebar, closeSidebar } = useAppLayout();

  return (
    <div>
      <button type="button" onClick={openSidebar}>
        Open sidebar
      </button>
      <button type="button" onClick={closeSidebar}>
        Close sidebar
      </button>
    </div>
  );
};

describe("AppLayout sidebar persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("chatkit.sidebar.open", "false");
  });

  it("updates the stored sidebar preference immediately when toggled on desktop", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={(
              <AppLayout>
                <SidebarControls />
              </AppLayout>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(window.localStorage.getItem("chatkit.sidebar.open")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Open sidebar" }));
    expect(window.localStorage.getItem("chatkit.sidebar.open")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Close sidebar" }));
    expect(window.localStorage.getItem("chatkit.sidebar.open")).toBe("false");
  });
});
