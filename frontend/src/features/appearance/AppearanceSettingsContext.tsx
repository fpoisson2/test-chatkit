import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  type AppearanceSettings,
  appearanceSettingsApi,
} from "../../utils/backend";

const DEFAULT_BODY_FONT =
  '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const DEFAULT_HEADING_FONT = DEFAULT_BODY_FONT;
const DEFAULT_ACCENT = "#2563eb";
const DEFAULT_SURFACE_HUE = 222;
const DEFAULT_SURFACE_TINT = 92;
const DEFAULT_SURFACE_SHADE = 16;
const DEFAULT_LIGHT_SURFACE = "#ffffff";
const DEFAULT_LIGHT_SURFACE_SUBTLE = "#f4f4f5";
const DEFAULT_LIGHT_BORDER = "rgba(24, 24, 27, 0.12)";
const DEFAULT_DARK_SURFACE = "#18181b";
const DEFAULT_DARK_SURFACE_SUBTLE = "#111114";
const DEFAULT_DARK_BORDER = "rgba(228, 228, 231, 0.16)";
const DEFAULT_RADIUS_STYLE = "soft" as const;
const RADIUS_PRESETS: Record<
  string,
  {
    "2xs": string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    "2xl": string;
    "3xl": string;
    "4xl": string;
    full: string;
  }
> = {
  soft: {
    "2xs": "0.125rem",
    xs: "0.25rem",
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.625rem",
    xl: "0.75rem",
    "2xl": "1rem",
    "3xl": "1.25rem",
    "4xl": "1.5rem",
    full: "9999px",
  },
  round: {
    "2xs": "0.5rem",
    xs: "0.65rem",
    sm: "0.75rem",
    md: "0.9rem",
    lg: "1rem",
    xl: "1.15rem",
    "2xl": "1.35rem",
    "3xl": "1.6rem",
    "4xl": "1.85rem",
    full: "9999px",
  },
  pill: {
    "2xs": "9999px",
    xs: "9999px",
    sm: "9999px",
    md: "9999px",
    lg: "9999px",
    xl: "9999px",
    "2xl": "9999px",
    "3xl": "9999px",
    "4xl": "9999px",
    full: "9999px",
  },
  sharp: {
    "2xs": "0px",
    xs: "0px",
    sm: "0px",
    md: "0px",
    lg: "0px",
    xl: "0px",
    "2xl": "0px",
    "3xl": "0px",
    "4xl": "0px",
    full: "9999px",
  },
};

const sanitizeRadiusStyle = (
  value: string | null | undefined,
): keyof typeof RADIUS_PRESETS => {
  const normalized = value?.trim().toLowerCase();
  if (normalized && normalized in RADIUS_PRESETS) {
    return normalized as keyof typeof RADIUS_PRESETS;
  }
  return DEFAULT_RADIUS_STYLE;
};

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  color_scheme: "system",
  radius_style: DEFAULT_RADIUS_STYLE,
  accent_color: DEFAULT_ACCENT,
  use_custom_surface_colors: false,
  surface_hue: DEFAULT_SURFACE_HUE,
  surface_tint: DEFAULT_SURFACE_TINT,
  surface_shade: DEFAULT_SURFACE_SHADE,
  heading_font: DEFAULT_HEADING_FONT,
  body_font: DEFAULT_BODY_FONT,
  start_screen_greeting: "",
  start_screen_prompt: "",
  start_screen_placeholder: "Posez votre question...",
  start_screen_disclaimer: "",
  created_at: null,
  updated_at: null,
};

export type AppearanceWorkflowReference =
  | { kind: "local"; id: number }
  | { kind: "hosted"; slug: string }
  | null;

type AppearanceSettingsContextValue = {
  settings: AppearanceSettings;
  isLoading: boolean;
  refresh: () => Promise<void>;
  applySnapshot: (next: AppearanceSettings) => void;
  setActiveWorkflow: (reference: AppearanceWorkflowReference) => Promise<void>;
  activeWorkflow: AppearanceWorkflowReference;
};

const AppearanceSettingsContext = createContext<
  AppearanceSettingsContextValue | undefined
>(undefined);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const sanitizeHexColor = (value: string | null | undefined): string => {
  if (!value) {
    return DEFAULT_ACCENT;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_ACCENT;
  }
  if (trimmed.startsWith("#")) {
    if (trimmed.length === 7) {
      return trimmed;
    }
    if (trimmed.length === 4) {
      return `#${trimmed.slice(1).repeat(2)}`.slice(0, 7);
    }
    return `#${trimmed.slice(1, 7).padEnd(6, "0")}`;
  }
  if (trimmed.length === 3) {
    return `#${trimmed.repeat(2)}`.slice(0, 7);
  }
  return `#${trimmed.slice(0, 6).padEnd(6, "0")}`;
};

type RgbColor = { r: number; g: number; b: number };

type HslColor = { h: number; s: number; l: number };

const hexToRgb = (value: string): RgbColor | null => {
  const normalized = value.replace(/^#/, "");
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) {
    return null;
  }
  const hex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch.repeat(2))
          .join("")
      : normalized;
  const int = parseInt(hex, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return { r, g, b };
};

const rgbToHex = ({ r, g, b }: RgbColor): string =>
  `#${[r, g, b]
    .map((component) => component.toString(16).padStart(2, "0"))
    .join("")}`;

const rgbToHsl = ({ r, g, b }: RgbColor): HslColor => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
  }
  h *= 60;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
};

const hslToRgb = ({ h, s, l }: HslColor): RgbColor => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (segment >= 0 && segment < 1) {
    r1 = chroma;
    g1 = x;
  } else if (segment >= 1 && segment < 2) {
    r1 = x;
    g1 = chroma;
  } else if (segment >= 2 && segment < 3) {
    g1 = chroma;
    b1 = x;
  } else if (segment >= 3 && segment < 4) {
    g1 = x;
    b1 = chroma;
  } else if (segment >= 4 && segment < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }
  const m = l - chroma / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
};

const adjustLightness = (hex: string, delta: number): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }
  const hsl = rgbToHsl(rgb);
  const nextLightness = clamp(hsl.l + delta, 0, 1);
  return rgbToHex(hslToRgb({ ...hsl, l: nextLightness }));
};

const mergeAppearance = (
  payload: AppearanceSettings | null | undefined,
): AppearanceSettings => ({
  ...DEFAULT_APPEARANCE_SETTINGS,
  ...(payload ?? {}),
  radius_style: sanitizeRadiusStyle(
    payload?.radius_style ?? DEFAULT_APPEARANCE_SETTINGS.radius_style,
  ),
  accent_color: sanitizeHexColor(payload?.accent_color ?? DEFAULT_ACCENT),
  heading_font:
    payload?.heading_font?.trim() || DEFAULT_APPEARANCE_SETTINGS.heading_font,
  body_font:
    payload?.body_font?.trim() || DEFAULT_APPEARANCE_SETTINGS.body_font,
  start_screen_greeting: payload?.start_screen_greeting ?? "",
  start_screen_prompt: payload?.start_screen_prompt ?? "",
  start_screen_placeholder:
    payload?.start_screen_placeholder ?? DEFAULT_APPEARANCE_SETTINGS.start_screen_placeholder,
  start_screen_disclaimer: payload?.start_screen_disclaimer ?? "",
  use_custom_surface_colors: Boolean(payload?.use_custom_surface_colors),
  surface_hue:
    payload?.surface_hue ?? DEFAULT_APPEARANCE_SETTINGS.surface_hue,
  surface_tint:
    payload?.surface_tint ?? DEFAULT_APPEARANCE_SETTINGS.surface_tint,
  surface_shade:
    payload?.surface_shade ?? DEFAULT_APPEARANCE_SETTINGS.surface_shade,
  created_at: payload?.created_at ?? null,
  updated_at: payload?.updated_at ?? null,
});

type SurfacePalette = {
  lightSurface: string;
  lightSurfaceSubtle: string;
  lightBorder: string;
  darkSurface: string;
  darkSurfaceSubtle: string;
  darkBorder: string;
};

const buildSurfacePalette = (
  settings: AppearanceSettings,
): SurfacePalette => {
  if (!settings.use_custom_surface_colors) {
    return {
      lightSurface: DEFAULT_LIGHT_SURFACE,
      lightSurfaceSubtle: DEFAULT_LIGHT_SURFACE_SUBTLE,
      lightBorder: DEFAULT_LIGHT_BORDER,
      darkSurface: DEFAULT_DARK_SURFACE,
      darkSurfaceSubtle: DEFAULT_DARK_SURFACE_SUBTLE,
      darkBorder: DEFAULT_DARK_BORDER,
    };
  }
  const hue = clamp(settings.surface_hue ?? DEFAULT_SURFACE_HUE, 0, 360);
  const tint = clamp(settings.surface_tint ?? DEFAULT_SURFACE_TINT, 0, 100);
  const shade = clamp(settings.surface_shade ?? DEFAULT_SURFACE_SHADE, 0, 100);
  const lightSurface = `hsl(${hue} 28% ${clamp(tint, 20, 98)}%)`;
  const lightSurfaceSubtle = `hsl(${hue} 32% ${clamp(tint + 4, 20, 100)}%)`;
  const lightBorder = `hsla(${hue} 30% ${clamp(tint - 38, 0, 90)}%, 0.28)`;
  const darkSurface = `hsl(${hue} 20% ${clamp(shade, 2, 42)}%)`;
  const darkSurfaceSubtle = `hsl(${hue} 18% ${clamp(shade - 6, 0, 32)}%)`;
  const darkBorder = `hsla(${hue} 34% ${clamp(shade + 30, 0, 100)}%, 0.28)`;
  return {
    lightSurface,
    lightSurfaceSubtle,
    lightBorder,
    darkSurface,
    darkSurfaceSubtle,
    darkBorder,
  };
};

const applyDocumentTheme = (settings: AppearanceSettings) => {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const scheme = settings.color_scheme ?? "system";
  if (scheme === "light" || scheme === "dark") {
    root.dataset.theme = scheme;
  } else {
    delete root.dataset.theme;
  }
  const radiusStyle = sanitizeRadiusStyle(settings.radius_style);
  const radiusPreset = RADIUS_PRESETS[radiusStyle];
  Object.entries(radiusPreset).forEach(([token, value]) => {
    root.style.setProperty(`--radius-${token}`, value);
  });
  root.style.setProperty("--button-radius", radiusPreset.md);
  const palette = buildSurfacePalette(settings);
  root.style.setProperty("--appearance-accent", settings.accent_color);
  root.style.setProperty(
    "--appearance-accent-hover",
    adjustLightness(settings.accent_color, scheme === "dark" ? 0.08 : -0.12),
  );
  root.style.setProperty("--appearance-body-font", settings.body_font);
  root.style.setProperty("--appearance-heading-font", settings.heading_font);
  root.style.setProperty("--appearance-light-surface", palette.lightSurface);
  root.style.setProperty(
    "--appearance-light-surface-subtle",
    palette.lightSurfaceSubtle,
  );
  root.style.setProperty("--appearance-light-border", palette.lightBorder);
  root.style.setProperty("--appearance-dark-surface", palette.darkSurface);
  root.style.setProperty(
    "--appearance-dark-surface-subtle",
    palette.darkSurfaceSubtle,
  );
  root.style.setProperty("--appearance-dark-border", palette.darkBorder);
};

export const AppearanceSettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [settings, setSettings] = useState<AppearanceSettings>(
    DEFAULT_APPEARANCE_SETTINGS,
  );
  const [isLoading, setLoading] = useState(true);
  const [activeWorkflow, setActiveWorkflowState] =
    useState<AppearanceWorkflowReference>(null);
  const workflowReferenceRef = useRef<number | string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    applyDocumentTheme(settings);
  }, [settings]);

  const applySnapshot = useCallback((next: AppearanceSettings) => {
    setSettings(mergeAppearance(next));
  }, []);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const snapshot = await appearanceSettingsApi.get(null, {
        scope: "public",
        workflowId:
          workflowReferenceRef.current != null
            ? workflowReferenceRef.current
            : undefined,
      });
      if (requestIdRef.current === requestId) {
        setSettings(mergeAppearance(snapshot));
      }
    } catch (error) {
      if (import.meta.env.DEV) {
      }
      if (requestIdRef.current === requestId) {
        setSettings(DEFAULT_APPEARANCE_SETTINGS);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const setActiveWorkflow = useCallback(
    async (reference: AppearanceWorkflowReference) => {
      setActiveWorkflowState(reference);
      if (!reference) {
        workflowReferenceRef.current = null;
      } else if (reference.kind === "local") {
        workflowReferenceRef.current = reference.id;
      } else {
        workflowReferenceRef.current = reference.slug;
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AppearanceSettingsContextValue>(
    () => ({
      settings,
      isLoading,
      refresh,
      applySnapshot,
      setActiveWorkflow,
      activeWorkflow,
    }),
    [
      activeWorkflow,
      applySnapshot,
      isLoading,
      refresh,
      setActiveWorkflow,
      settings,
    ],
  );

  return (
    <AppearanceSettingsContext.Provider value={value}>
      {children}
    </AppearanceSettingsContext.Provider>
  );
};

export const useAppearanceSettings = () => {
  const context = useContext(AppearanceSettingsContext);
  if (!context) {
    throw new Error(
      "useAppearanceSettings must be used within AppearanceSettingsProvider",
    );
  }
  return context;
};
