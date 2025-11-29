import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatTheme } from "../useChatTheme";
import type { AppearanceSettings } from "../../utils/backend";

const createMockSettings = (overrides: Partial<AppearanceSettings> = {}): AppearanceSettings => ({
  accent_color: "#3b82f6",
  body_font: "Inter",
  color_scheme: "system",
  start_screen_greeting: null,
  start_screen_prompt: null,
  start_screen_disclaimer: null,
  start_screen_placeholder: null,
  use_custom_surface_colors: false,
  surface_hue: 222,
  surface_tint: 92,
  surface_shade: 16,
  ...overrides,
});

describe("useChatTheme", () => {
  const originalDocumentElement = document.documentElement;

  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("should return light color scheme when settings specify light", () => {
    const settings = createMockSettings({ color_scheme: "light" });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "dark" })
    );

    expect(result.current.colorScheme).toBe("light");
  });

  it("should return dark color scheme when settings specify dark", () => {
    const settings = createMockSettings({ color_scheme: "dark" });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "light" })
    );

    expect(result.current.colorScheme).toBe("dark");
  });

  it("should use preferred color scheme when settings specify system", () => {
    const settings = createMockSettings({ color_scheme: "system" });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "dark" })
    );

    expect(result.current.colorScheme).toBe("dark");
  });

  it("should parse greeting from settings", () => {
    const settings = createMockSettings({ start_screen_greeting: "Hello World" });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "light" })
    );

    expect(result.current.greeting).toBe("Hello World");
  });

  it("should return null greeting when empty or whitespace", () => {
    const settings = createMockSettings({ start_screen_greeting: "   " });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "light" })
    );

    expect(result.current.greeting).toBeNull();
  });

  it("should parse prompts from settings", () => {
    const settings = createMockSettings({
      start_screen_prompt: "Question 1|Ask about this\nQuestion 2"
    });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "light" })
    );

    expect(result.current.prompts).toHaveLength(2);
    expect(result.current.prompts[0]).toEqual({
      label: "Question 1",
      prompt: "Ask about this",
      icon: "sparkle",
    });
    expect(result.current.prompts[1]).toEqual({
      label: "Question 2",
      prompt: "Question 2",
    });
  });

  it("should return default surface colors when custom colors disabled", () => {
    const settings = createMockSettings({ use_custom_surface_colors: false });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "light" })
    );

    expect(result.current.surface.background).toBe("#ffffff");
  });

  it("should return custom surface colors when enabled", () => {
    const settings = createMockSettings({
      use_custom_surface_colors: true,
      surface_hue: 200,
      surface_tint: 90,
      surface_shade: 20,
    });

    const { result } = renderHook(() =>
      useChatTheme({ appearanceSettings: settings, preferredColorScheme: "light" })
    );

    expect(result.current.surface.background).toContain("hsl(200");
  });
});
