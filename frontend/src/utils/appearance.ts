import type { AppearanceSettings } from "./backend";
import type { StartScreenPrompt } from "../chatkit";

export type ResolvedColorScheme = "light" | "dark";

export type SurfacePalette = {
  light: { background: string; foreground: string; border: string };
  dark: { background: string; foreground: string; border: string };
};

// Default color constants
const DEFAULT_LIGHT_SURFACE = "#ffffff";
const DEFAULT_LIGHT_SURFACE_SUBTLE = "#f4f4f5";
const DEFAULT_LIGHT_BORDER = "rgba(24, 24, 27, 0.12)";
const DEFAULT_DARK_SURFACE = "#18181b";
const DEFAULT_DARK_SURFACE_SUBTLE = "#111114";
const DEFAULT_DARK_BORDER = "rgba(228, 228, 231, 0.16)";

export const clampToRange = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const buildSurfacePalette = (settings: AppearanceSettings): SurfacePalette => {
  if (!settings.use_custom_surface_colors) {
    return {
      light: {
        background: DEFAULT_LIGHT_SURFACE,
        foreground: DEFAULT_LIGHT_SURFACE_SUBTLE,
        border: DEFAULT_LIGHT_BORDER,
      },
      dark: {
        background: DEFAULT_DARK_SURFACE,
        foreground: DEFAULT_DARK_SURFACE_SUBTLE,
        border: DEFAULT_DARK_BORDER,
      },
    };
  }

  const hue = clampToRange(settings.surface_hue ?? 222, 0, 360);
  const tint = clampToRange(settings.surface_tint ?? 92, 0, 100);
  const shade = clampToRange(settings.surface_shade ?? 16, 0, 100);

  const lightBackground = `hsl(${hue} 28% ${clampToRange(tint, 20, 98)}%)`;
  const lightForeground = `hsl(${hue} 32% ${clampToRange(tint + 4, 20, 100)}%)`;
  const lightBorder = `hsla(${hue} 30% ${clampToRange(tint - 38, 0, 90)}%, 0.28)`;
  const darkBackground = `hsl(${hue} 20% ${clampToRange(shade, 2, 42)}%)`;
  const darkForeground = `hsl(${hue} 18% ${clampToRange(shade - 6, 0, 32)}%)`;
  const darkBorder = `hsla(${hue} 34% ${clampToRange(shade + 30, 0, 100)}%, 0.28)`;

  return {
    light: {
      background: lightBackground,
      foreground: lightForeground,
      border: lightBorder,
    },
    dark: {
      background: darkBackground,
      foreground: darkForeground,
      border: darkBorder,
    },
  };
};

export const resolveSurfaceColors = (
  palette: SurfacePalette,
  scheme: ResolvedColorScheme,
): SurfacePalette["light"] =>
  scheme === "dark" ? palette.dark : palette.light;

export const resolveThemeColorScheme = (
  settings: AppearanceSettings,
  preferred: ResolvedColorScheme,
): ResolvedColorScheme => {
  if (settings.color_scheme === "light" || settings.color_scheme === "dark") {
    return settings.color_scheme;
  }
  return preferred;
};

export const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export const parseStartScreenPrompts = (
  raw: string | null | undefined,
): StartScreenPrompt[] => {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry, index) => {
      const separatorIndex = entry.indexOf("|");

      let label = entry;
      let prompt = entry;

      if (separatorIndex !== -1) {
        const rawLabel = entry.slice(0, separatorIndex).trim();
        const rawPrompt = entry.slice(separatorIndex + 1).trim();

        if (rawLabel || rawPrompt) {
          label = rawLabel || rawPrompt;
          prompt = rawPrompt || rawLabel || entry;
        }
      }

      return {
        label,
        prompt,
        ...(index === 0 ? { icon: "sparkle" as const } : {}),
      };
    });
};
