import { useEffect, useState } from "react";

type ColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const isColorScheme = (value: string | null | undefined): value is ColorScheme => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === "light" || normalized === "dark";
};

const readThemeAttribute = (): ColorScheme | null => {
  if (typeof document === "undefined") {
    return null;
  }
  const value = document.documentElement.dataset.theme;
  if (!isColorScheme(value)) {
    return null;
  }
  return value.toLowerCase() as ColorScheme;
};

const getInitialScheme = (): ColorScheme => {
  const themeAttribute = readThemeAttribute();
  if (themeAttribute) {
    return themeAttribute;
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
};

export function usePreferredColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(getInitialScheme);

  useEffect(() => {
    const applyScheme = (next: ColorScheme) => {
      setScheme((current) => (current === next ? current : next));
    };

    const themeFromAttribute = readThemeAttribute();
    if (themeFromAttribute) {
      applyScheme(themeFromAttribute);
    }

    if (typeof window === "undefined") {
      return undefined;
    }

    let mediaQuery: MediaQueryList | null = null;
    const getSchemeFromMediaQuery = () =>
      mediaQuery && mediaQuery.matches ? ("dark" as ColorScheme) : ("light" as ColorScheme);

    const handleMediaChange = (event: MediaQueryListEvent) => {
      if (readThemeAttribute()) {
        return;
      }
      applyScheme(event.matches ? "dark" : "light");
    };

    if (typeof window.matchMedia === "function") {
      mediaQuery = window.matchMedia(DARK_QUERY);
      if (!themeFromAttribute) {
        applyScheme(getSchemeFromMediaQuery());
      }

      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", handleMediaChange);
      } else if (typeof mediaQuery.addListener === "function") {
        // Fallback for older browsers
        mediaQuery.addListener(handleMediaChange);
      }
    }

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver === "function" && typeof document !== "undefined") {
      observer = new MutationObserver(() => {
        const nextFromAttribute = readThemeAttribute();
        if (nextFromAttribute) {
          applyScheme(nextFromAttribute);
          return;
        }
        applyScheme(getSchemeFromMediaQuery());
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }

    return () => {
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === "function") {
          mediaQuery.removeEventListener("change", handleMediaChange);
        } else if (typeof mediaQuery.removeListener === "function") {
          mediaQuery.removeListener(handleMediaChange);
        }
      }
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  return scheme;
}
