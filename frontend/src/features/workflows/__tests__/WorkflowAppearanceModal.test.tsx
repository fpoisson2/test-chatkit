import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../utils/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/backend")>();
  return {
    ...actual,
    appearanceSettingsApi: {
      ...actual.appearanceSettingsApi,
      get: vi.fn(),
      update: vi.fn(),
      getForWorkflow: vi.fn(),
      updateForWorkflow: vi.fn(),
    },
  };
});

import { I18nProvider } from "../../../i18n";
import WorkflowAppearanceModal from "../WorkflowAppearanceModal";
import { appearanceSettingsApi } from "../../../utils/backend";

const mockedGetForWorkflow = vi.mocked(appearanceSettingsApi.getForWorkflow);
const mockedUpdateForWorkflow = vi.mocked(
  appearanceSettingsApi.updateForWorkflow,
);

const BASE_APPEARANCE = {
  color_scheme: "system" as const,
  accent_color: "#2563eb",
  use_custom_surface_colors: false,
  surface_hue: 222,
  surface_tint: 92,
  surface_shade: 16,
  heading_font: "Heading",
  body_font: "Body",
  start_screen_greeting: "",
  start_screen_prompt: "",
  start_screen_placeholder: "Ask…",
  start_screen_disclaimer: "",
  created_at: null,
  updated_at: null,
};

const LOCAL_TARGET = {
  kind: "local" as const,
  workflowId: 42,
  slug: "support",
  label: "Support",
};

describe("WorkflowAppearanceModal", () => {
  afterEach(() => {
    mockedGetForWorkflow.mockReset();
    mockedUpdateForWorkflow.mockReset();
  });

  it("loads current appearance, submits updates and supports reset", async () => {
    mockedGetForWorkflow.mockResolvedValueOnce({
      target_kind: "local",
      workflow_id: LOCAL_TARGET.workflowId,
      workflow_slug: LOCAL_TARGET.slug,
      label: LOCAL_TARGET.label,
      remote_workflow_id: null,
      override: null,
      effective: BASE_APPEARANCE,
      inherited_from_global: true,
    } as any);

    mockedUpdateForWorkflow
      .mockResolvedValueOnce({
        target_kind: "local",
        workflow_id: LOCAL_TARGET.workflowId,
        workflow_slug: LOCAL_TARGET.slug,
        label: LOCAL_TARGET.label,
        remote_workflow_id: null,
        override: {
          color_scheme: "light",
          accent_color: "#123456",
          use_custom_surface_colors: false,
          surface_hue: 222,
          surface_tint: 92,
          surface_shade: 16,
          heading_font: "Heading",
          body_font: "Body",
          start_screen_greeting: "",
          start_screen_prompt: "",
          start_screen_placeholder: "Ask…",
          start_screen_disclaimer: "",
          created_at: null,
          updated_at: null,
        },
        effective: {
          ...BASE_APPEARANCE,
          color_scheme: "light",
          accent_color: "#123456",
        },
        inherited_from_global: false,
      } as any)
      .mockResolvedValueOnce({
        target_kind: "local",
        workflow_id: LOCAL_TARGET.workflowId,
        workflow_slug: LOCAL_TARGET.slug,
        label: LOCAL_TARGET.label,
        remote_workflow_id: null,
        override: null,
        effective: BASE_APPEARANCE,
        inherited_from_global: true,
      } as any);

    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <I18nProvider>
        <WorkflowAppearanceModal
          token="token"
          isOpen
          target={LOCAL_TARGET}
          onClose={onClose}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(mockedGetForWorkflow).toHaveBeenCalledWith("token", 42);
    });

    const saveButton = await screen.findByRole("button", { name: /save/i });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    await waitFor(() => {
      expect(mockedUpdateForWorkflow).toHaveBeenCalledWith("token", 42, {
        accent_color: "#2563eb",
        body_font: "Body",
        color_scheme: "system",
        heading_font: "Heading",
        start_screen_disclaimer: "",
        start_screen_greeting: "",
        start_screen_placeholder: "Ask…",
        start_screen_prompt: "",
        surface_hue: 222,
        surface_shade: 16,
        surface_tint: 92,
        use_custom_surface_colors: false,
      });
    });

    const resetButton = await screen.findByRole("button", {
      name: /reset to global/i,
    });
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);
    await waitFor(() => {
      expect(mockedUpdateForWorkflow).toHaveBeenLastCalledWith("token", 42, {
        inherit_from_global: true,
      });
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});

