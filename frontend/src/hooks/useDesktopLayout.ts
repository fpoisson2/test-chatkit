import { useCallback, useSyncExternalStore } from "react";

const DESKTOP_BREAKPOINT = 1024;
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

type NavigatorWithUA = Navigator & {
  userAgentData?: {
    mobile?: boolean;
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
    onchange?: ((event: Event) => void) | null;
  };
};

const getNavigator = () => {
  if (typeof navigator === "undefined") {
    return null;
  }

  return navigator as NavigatorWithUA;
};

const getViewportWidthCandidates = () => {
  if (typeof window === "undefined") {
    return [] as number[];
  }

  const candidates: number[] = [
    window.innerWidth,
    window.document?.documentElement?.clientWidth ?? 0,
  ];

  if (window.visualViewport) {
    const { width, scale } = window.visualViewport;

    if (typeof width === "number" && Number.isFinite(width)) {
      candidates.push(width);

      if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) {
        candidates.push(width * scale);
        candidates.push(width / scale);
      }
    }
  }

  return candidates.filter((value) => Number.isFinite(value) && value > 0);
};

const isDesktopForcedByBrowser = () => {
  const nav = getNavigator();
  if (!nav) {
    return false;
  }

  const uaData = nav.userAgentData;
  if (!uaData || typeof uaData.mobile !== "boolean") {
    return false;
  }

  if (uaData.mobile) {
    return false;
  }

  const maxTouchPoints = typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;
  const pointerIsCoarse =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(COARSE_POINTER_QUERY).matches
      : maxTouchPoints > 1;

  return pointerIsCoarse || maxTouchPoints > 1;
};

export const getDesktopLayoutPreference = () => {
  if (typeof window === "undefined") {
    return false;
  }

  if (typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_MEDIA_QUERY).matches) {
    return true;
  }

  const candidates = getViewportWidthCandidates();
  if (candidates.some((value) => value >= DESKTOP_BREAKPOINT)) {
    return true;
  }

  if (isDesktopForcedByBrowser()) {
    return true;
  }

  return false;
};

const subscribeToMediaChanges = (callback: () => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => {
    callback();
  };

  const cleanups: Array<() => void> = [];

  let mediaQuery: MediaQueryList | null = null;
  let coarsePointerQuery: MediaQueryList | null = null;

  if (typeof window.matchMedia === "function") {
    mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      cleanups.push(() => mediaQuery?.removeEventListener("change", handleChange));
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
      cleanups.push(() => mediaQuery?.removeListener(handleChange));
    }

    coarsePointerQuery = window.matchMedia(COARSE_POINTER_QUERY);
    if (coarsePointerQuery) {
      if (typeof coarsePointerQuery.addEventListener === "function") {
        coarsePointerQuery.addEventListener("change", handleChange);
        cleanups.push(() => coarsePointerQuery?.removeEventListener("change", handleChange));
      } else if (typeof coarsePointerQuery.addListener === "function") {
        coarsePointerQuery.addListener(handleChange);
        cleanups.push(() => coarsePointerQuery?.removeListener(handleChange));
      }
    }
  }

  window.addEventListener("resize", handleChange);
  cleanups.push(() => window.removeEventListener("resize", handleChange));

  if (window.visualViewport) {
    const handleViewportChange = () => {
      callback();
    };
    window.visualViewport.addEventListener("resize", handleViewportChange);
    window.visualViewport.addEventListener("scroll", handleViewportChange);
    cleanups.push(() => {
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    });
  }

  const nav = getNavigator();
  if (nav?.userAgentData) {
    const handleUAChange = () => {
      callback();
    };

    const { userAgentData } = nav;
    if (typeof userAgentData.addEventListener === "function") {
      userAgentData.addEventListener("change", handleUAChange);
      cleanups.push(() => userAgentData.removeEventListener?.("change", handleUAChange));
    } else if ("onchange" in userAgentData) {
      const previous = userAgentData.onchange;
      const fallbackHandler = (event: Event) => {
        previous?.call(userAgentData, event);
        handleUAChange();
      };
      userAgentData.onchange = fallbackHandler;
      cleanups.push(() => {
        if (userAgentData.onchange === fallbackHandler) {
          userAgentData.onchange = previous ?? null;
        }
      });
    }
  }

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
};

export const useIsDesktopLayout = () => {
  const getSnapshot = useCallback(() => getDesktopLayoutPreference(), []);

  const subscribe = useCallback((callback: () => void) => subscribeToMediaChanges(callback), []);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};
