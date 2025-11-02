import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

import {
  AppearanceSettingsProvider,
  useAppearanceSettings,
} from "../AppearanceSettingsContext";
import { appearanceSettingsApi } from "../../../utils/backend";

const mockedGet = vi.mocked(appearanceSettingsApi.get);

const GLOBAL_SETTINGS = {
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

const WORKFLOW_SETTINGS = {
  ...GLOBAL_SETTINGS,
  accent_color: "#ff0000",
};

const TestConsumer = () => {
  const { settings, setActiveWorkflow } = useAppearanceSettings();

  useEffect(() => {
    void setActiveWorkflow({ kind: "local", id: 7 });
  }, [setActiveWorkflow]);

  return <span data-testid="accent-color">{settings.accent_color}</span>;
};

describe("AppearanceSettingsContext", () => {
  afterEach(() => {
    mockedGet.mockReset();
  });

  it("fetches scoped appearance settings when the active workflow changes", async () => {
    mockedGet
      .mockResolvedValueOnce(GLOBAL_SETTINGS)
      .mockResolvedValueOnce(WORKFLOW_SETTINGS);

    render(
      <AppearanceSettingsProvider>
        <TestConsumer />
      </AppearanceSettingsProvider>,
    );

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });

    expect(mockedGet).toHaveBeenNthCalledWith(1, null, {
      scope: "public",
      workflowId: undefined,
    });
    expect(mockedGet).toHaveBeenNthCalledWith(2, null, {
      scope: "public",
      workflowId: 7,
    });

    await waitFor(() => {
      expect(screen.getByTestId("accent-color").textContent).toBe("#ff0000");
    });
  });
});

