import { describe, test, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import React from "react";
import WorkflowBuilderContainer from "./WorkflowBuilderContainer";
import { useViewportContext } from "./contexts";

const capturedViewportValues: {
  persistViewportMemory?: unknown;
  reactFlowInstanceRef?: unknown;
  viewportRef?: unknown;
  pendingViewportRestoreRef?: unknown;
  isHydratingRef?: unknown;
} = {};

// Mock des modules externes
vi.mock("../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { id: 1, username: "test", is_admin: false },
    logout: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../components/AppLayout", () => ({
  useAppLayout: () => ({
    openSidebar: vi.fn(),
    closeSidebar: vi.fn(),
    isSidebarCollapsed: false,
  }),
  useSidebarPortal: () => ({
    setSidebarContent: vi.fn(),
    clearSidebarContent: vi.fn(),
    setCollapsedSidebarContent: vi.fn(),
    clearCollapsedSidebarContent: vi.fn(),
  }),
}));

vi.mock("./components/WorkflowBuilderCanvas", () => ({
  __esModule: true,
  default: () => {
    const {
      persistViewportMemory,
      reactFlowInstanceRef,
      viewportRef,
      pendingViewportRestoreRef,
      isHydratingRef,
    } = useViewportContext();
    capturedViewportValues.persistViewportMemory = persistViewportMemory;
    capturedViewportValues.reactFlowInstanceRef = reactFlowInstanceRef;
    capturedViewportValues.viewportRef = viewportRef;
    capturedViewportValues.pendingViewportRestoreRef = pendingViewportRestoreRef;
    capturedViewportValues.isHydratingRef = isHydratingRef;
    return <div data-testid="mock-workflow-builder-canvas" />;
  },
}));

// Mock fetch global
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
    status: 200,
  } as Response)
);

describe("WorkflowBuilderContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedViewportValues.persistViewportMemory = undefined;
    capturedViewportValues.reactFlowInstanceRef = undefined;
    capturedViewportValues.viewportRef = undefined;
    capturedViewportValues.pendingViewportRestoreRef = undefined;
    capturedViewportValues.isHydratingRef = undefined;
  });

  test("se monte sans erreur avec tous les contextes", () => {
    // Ce test vérifie que tous les 7 contextes sont correctement montés
    // et que WorkflowBuilderPage peut accéder à useSaveContext, useUIContext, etc.
    expect(() => {
      render(
        <BrowserRouter>
          <WorkflowBuilderContainer />
        </BrowserRouter>
      );
    }).not.toThrow();
  });

  test("fournit SaveContext à WorkflowBuilderPage", () => {
    // Si SaveProvider n'est pas monté, useSaveContext() dans WorkflowBuilderPage
    // va lancer une erreur "useSaveContext must be used within SaveProvider"
    const { container } = render(
      <BrowserRouter>
        <WorkflowBuilderContainer />
      </BrowserRouter>
    );

    // Si on arrive ici sans erreur, c'est que SaveContext fonctionne
    expect(container).toBeTruthy();
  });

  test("fournit tous les 7 contextes (SaveContext, UIContext, ModalContext, SelectionContext, GraphContext, ViewportContext, WorkflowContext)", () => {
    // Test de smoke qui vérifie que l'arbre de providers est complet
    // Ordre attendu (de l'extérieur vers l'intérieur):
    // ReactFlowProvider -> WorkflowProvider -> SelectionProvider -> GraphProvider
    // -> SaveProvider -> ModalProvider -> ViewportProvider -> UIProvider

    const { container } = render(
      <BrowserRouter>
        <WorkflowBuilderContainer />
      </BrowserRouter>
    );

    // Si tous les contextes sont montés, le composant se rend sans erreur
    expect(container).toBeTruthy();
    expect(container.querySelector('[data-testid], [role], [aria-label]')).toBeTruthy();
  });

  test("expose les refs de viewport et la persistance au canvas", () => {
    render(
      <BrowserRouter>
        <WorkflowBuilderContainer />
      </BrowserRouter>,
    );

    expect(typeof capturedViewportValues.persistViewportMemory).toBe("function");
    expect(capturedViewportValues.reactFlowInstanceRef).toBeTruthy();
    expect(capturedViewportValues.viewportRef).toBeTruthy();
    expect(capturedViewportValues.pendingViewportRestoreRef).toBeTruthy();
    expect(capturedViewportValues.isHydratingRef).toBeTruthy();
  });
});
