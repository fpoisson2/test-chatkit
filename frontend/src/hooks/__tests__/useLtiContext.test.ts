import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLtiContext } from "../useLtiContext";
import type { WorkflowSummary } from "../../types/workflows";

const createMockWorkflow = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  id: 1,
  slug: "test-workflow",
  display_name: "Test Workflow",
  description: null,
  is_chatkit_default: false,
  active_version_id: 1,
  lti_enabled: false,
  lti_show_sidebar: true,
  lti_show_header: true,
  lti_enable_history: true,
  ...overrides,
});

describe("useLtiContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it("should not show loading overlay for non-LTI users", () => {
    const setHideSidebar = vi.fn();

    const { result } = renderHook(() =>
      useLtiContext({
        isLtiUser: false,
        activeWorkflow: null,
        workflowsLoading: false,
        setHideSidebar,
      })
    );

    expect(result.current.isLtiContext).toBe(false);
    expect(result.current.shouldShowLoadingOverlay).toBe(false);
  });

  it("should detect LTI context from localStorage", () => {
    localStorage.setItem("lti_launch_workflow_id", "123");
    const setHideSidebar = vi.fn();

    const { result } = renderHook(() =>
      useLtiContext({
        isLtiUser: false,
        activeWorkflow: null,
        workflowsLoading: true,
        setHideSidebar,
      })
    );

    expect(result.current.isLtiContext).toBe(true);
  });

  it("should show loading overlay for LTI users until workflow loads", () => {
    const setHideSidebar = vi.fn();

    const { result, rerender } = renderHook(
      ({ activeWorkflow, workflowsLoading }) =>
        useLtiContext({
          isLtiUser: true,
          activeWorkflow,
          workflowsLoading,
          setHideSidebar,
        }),
      {
        initialProps: { activeWorkflow: null, workflowsLoading: true },
      }
    );

    expect(result.current.shouldShowLoadingOverlay).toBe(true);

    // Workflow loaded
    const workflow = createMockWorkflow();
    rerender({ activeWorkflow: workflow, workflowsLoading: false });

    // Still loading (waiting for timeout)
    expect(result.current.shouldShowLoadingOverlay).toBe(true);

    // After timeout
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.shouldShowLoadingOverlay).toBe(false);
  });

  it("should hide sidebar for LTI users", () => {
    const setHideSidebar = vi.fn();

    renderHook(() =>
      useLtiContext({
        isLtiUser: true,
        activeWorkflow: null,
        workflowsLoading: false,
        setHideSidebar,
      })
    );

    expect(setHideSidebar).toHaveBeenCalledWith(true);
  });

  it("should respect workflow lti_show_sidebar setting", () => {
    const setHideSidebar = vi.fn();
    const workflow = createMockWorkflow({ lti_enabled: true, lti_show_sidebar: false });

    renderHook(() =>
      useLtiContext({
        isLtiUser: true,
        activeWorkflow: workflow,
        workflowsLoading: false,
        setHideSidebar,
      })
    );

    // Should hide sidebar because lti_show_sidebar is false
    expect(setHideSidebar).toHaveBeenCalledWith(true);
  });
});
