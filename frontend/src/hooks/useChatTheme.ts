import { useEffect, useMemo } from "react";
import type { AppearanceSettings } from "../utils/backend";
import {
  buildSurfacePalette,
  resolveSurfaceColors,
  resolveThemeColorScheme,
  normalizeText,
  parseStartScreenPrompts,
  type ResolvedColorScheme,
} from "../utils/appearance";

export type ChatThemeConfig = {
  colorScheme: ResolvedColorScheme;
  surface: { background: string; foreground: string; border: string };
  greeting: string | null;
  prompts: ReturnType<typeof parseStartScreenPrompts>;
  disclaimerText: string | null;
};

export type UseChatThemeOptions = {
  appearanceSettings: AppearanceSettings;
  preferredColorScheme: ResolvedColorScheme;
};

export function useChatTheme({
  appearanceSettings,
  preferredColorScheme,
}: UseChatThemeOptions): ChatThemeConfig {
  // Apply theme to document root
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const colorSchemePreference = appearanceSettings.color_scheme;
    const resolvedScheme =
      colorSchemePreference === "light" || colorSchemePreference === "dark"
        ? colorSchemePreference
        : preferredColorScheme;

    if (colorSchemePreference === "system") {
      delete root.dataset.theme;
      return;
    }

    root.dataset.theme = resolvedScheme;
  }, [appearanceSettings.color_scheme, preferredColorScheme]);

  return useMemo(() => {
    const colorScheme = resolveThemeColorScheme(appearanceSettings, preferredColorScheme);
    const surfacePalette = buildSurfacePalette(appearanceSettings);
    const surface = resolveSurfaceColors(surfacePalette, colorScheme);
    const greeting = normalizeText(appearanceSettings.start_screen_greeting);
    const prompts = parseStartScreenPrompts(appearanceSettings.start_screen_prompt);
    const disclaimerText = normalizeText(appearanceSettings.start_screen_disclaimer);

    return {
      colorScheme,
      surface,
      greeting,
      prompts,
      disclaimerText,
    };
  }, [appearanceSettings, preferredColorScheme]);
}
