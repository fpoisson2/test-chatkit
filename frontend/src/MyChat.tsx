import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";

const DEVICE_ID_STORAGE_KEY = "chatkit-device-id";

const OPENAI_CHATKIT_BASE_URL = "https://api.openai.com/v1/chatkit/";
const CHATKIT_PROXY_PREFIX = "/api/chatkit/proxy/";

const DESKTOP_BREAKPOINT = 1024;
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

const _disallowedForwardHeaders = new Set([
  "content-length",
  "host",
]);

const sanitizeHeaders = (headers: Headers) => {
  _disallowedForwardHeaders.forEach((header) => headers.delete(header));
  return headers;
};

type NormalizedRequest = {
  url: string;
  init: RequestInit;
};

type MaybeDuplexRequestInit = RequestInit & { duplex?: "half" | "full" };

const buildRequestInitFromRequest = async (
  request: Request,
  override?: RequestInit,
): Promise<MaybeDuplexRequestInit> => {
  const method = (override?.method ?? request.method ?? "GET").toUpperCase();
  const headers = new Headers(override?.headers ?? request.headers ?? {});

  let body: Exclude<RequestInit["body"], undefined> | undefined;
  if (override && Object.prototype.hasOwnProperty.call(override, "body")) {
    body = override.body as Exclude<RequestInit["body"], undefined>;
  } else if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  const init: MaybeDuplexRequestInit = {
    method,
    headers,
    cache: override?.cache ?? request.cache,
    credentials: override?.credentials ?? request.credentials,
    integrity: override?.integrity ?? request.integrity,
    keepalive: override?.keepalive ?? request.keepalive,
    mode: override?.mode ?? request.mode,
    redirect: override?.redirect ?? request.redirect,
    referrer: override?.referrer ?? request.referrer,
    referrerPolicy: override?.referrerPolicy ?? request.referrerPolicy,
    signal: override?.signal ?? request.signal,
  };

  if (body !== undefined) {
    init.body = body;
  }

  if (override && "duplex" in override) {
    (init as MaybeDuplexRequestInit).duplex = (override as MaybeDuplexRequestInit).duplex;
  } else if ("duplex" in request) {
    (init as MaybeDuplexRequestInit).duplex = (request as MaybeDuplexRequestInit).duplex;
  }

  if (override && "priority" in override) {
    (init as typeof init & { priority?: unknown }).priority = (override as {
      priority?: unknown;
    }).priority;
  }

  return init;
};

const normalizeFetchArguments = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<NormalizedRequest | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  if (typeof input === "string" || input instanceof URL) {
    const url = input instanceof URL ? input.toString() : input;
    return {
      url,
      init: {
        ...(init ?? {}),
      },
    };
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    const cloned = input.clone();
    const initFromRequest = await buildRequestInitFromRequest(cloned, init);
    return {
      url: cloned.url,
      init: initFromRequest,
    };
  }

  return null;
};

let fetchProxyInstalled = false;

const installChatKitFetchProxy = () => {
  if (fetchProxyInstalled || typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const normalized = await normalizeFetchArguments(input, init);
    if (!normalized) {
      return originalFetch(input as RequestInfo, init);
    }

    const targetUrl = normalized.url;
    if (targetUrl.startsWith(OPENAI_CHATKIT_BASE_URL)) {
      const url = new URL(targetUrl);
      const relativePath = url.pathname.replace(/^\/v1\/chatkit\/?/, "");
      const proxiedUrl = `${CHATKIT_PROXY_PREFIX}${relativePath}${url.search}`;
      const headers = sanitizeHeaders(new Headers(normalized.init.headers ?? {}));
      const proxiedInit: MaybeDuplexRequestInit = {
        ...normalized.init,
        headers,
      };
      return originalFetch(proxiedUrl, proxiedInit);
    }

    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  fetchProxyInstalled = true;
};

if (typeof window !== "undefined") {
  installChatKitFetchProxy();
}

const getOrCreateDeviceId = () => {
  if (typeof window === "undefined") {
    return crypto.randomUUID();
  }

  let existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!existing) {
    existing = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, existing);
  }
  return existing;
};

type WeatherToolCall = {
  name: "get_weather";
  params: {
    city: string;
    country?: string | null;
  };
};

type ClientToolCall = WeatherToolCall;

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

const getDesktopLayoutPreference = () => {
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

const useIsDesktopLayout = () => {
  const getSnapshot = useCallback(() => getDesktopLayoutPreference(), []);

  const subscribe = useCallback((callback: () => void) => {
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
      cleanups.forEach((cleanup) => {
        cleanup();
      });
    };
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};

export function MyChat() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const isDesktopLayout = useIsDesktopLayout();
  const [isSidebarOpen, setIsSidebarOpen] = useState(getDesktopLayoutPreference);
  const previousIsDesktopRef = useRef(isDesktopLayout);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const wasDesktop = previousIsDesktopRef.current;

    if (isDesktopLayout) {
      if (!wasDesktop) {
        setIsSidebarOpen(true);
      }
    } else {
      setIsSidebarOpen(false);
    }

    previousIsDesktopRef.current = isDesktopLayout;
  }, [isDesktopLayout]);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const handleMainInteraction = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
  }, [closeSidebar, isDesktopLayout]);

  const openProfileSettings = useCallback(() => {
    setIsSettingsModalOpen(true);
  }, []);

  const closeProfileSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  const handleSidebarSettings = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    openProfileSettings();
  }, [closeSidebar, isDesktopLayout, openProfileSettings]);

  const goToHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleSidebarHome = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    goToHome();
  }, [closeSidebar, goToHome, isDesktopLayout]);

  const handleHomeFromModal = useCallback(() => {
    closeProfileSettings();
    goToHome();
  }, [closeProfileSettings, goToHome]);

  const handleGoToAdmin = useCallback(() => {
    closeProfileSettings();
    navigate("/admin");
  }, [closeProfileSettings, navigate]);

  const handleLogout = useCallback(() => {
    closeProfileSettings();
    logout();
  }, [closeProfileSettings, logout]);

  const handleSidebarAdmin = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    navigate("/admin");
  }, [closeSidebar, isDesktopLayout, navigate]);

  const handleSidebarLogout = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    logout();
  }, [closeSidebar, isDesktopLayout, logout]);

  const getClientSecret = useCallback(async (currentSecret: string | null) => {
    if (currentSecret) {
      return currentSecret;
    }

    const deviceId = getOrCreateDeviceId();
    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch("/api/chatkit/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ user: user?.email ?? deviceId }),
      });

      if (!res.ok) {
        const message = await res.text();
        const errorMessage = `Failed to fetch client secret: ${res.status} ${message}`;
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      const data = await res.json();
      if (!data?.client_secret) {
        const errorMessage = "Missing client_secret in ChatKit session response";
        setError(errorMessage);
        throw new Error(errorMessage);
      }

      return data.client_secret;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [token, user]);

  const chatkitOptions = useMemo(
    () =>
      ({
        api: {
          getClientSecret,
        },
        header: {
          leftAction: {
            icon: "menu",
            onClick: openSidebar,
          },
          rightAction: {
            icon: "settings-cog",
            onClick: openProfileSettings,
          },
        },
        theme: {
          colorScheme: "light" as const,
        },
        composer: {
          placeholder: "Posez votre question...",
        },
        onClientTool: async (toolCall) => {
          const { name, params } = toolCall as ClientToolCall;

          switch (name) {
            case "get_weather": {
              const city = params?.city?.trim();
              const country = params?.country?.trim();

              if (!city) {
                throw new Error("Le paramètre 'city' est requis pour l'outil météo.");
              }

              const searchParams = new URLSearchParams({ city });
              if (country) {
                searchParams.set("country", country);
              }

              const response = await fetch(`/api/tools/weather?${searchParams.toString()}`);
              if (!response.ok) {
                const details = await response.text();
                throw new Error(
                  `Échec de l'appel météo (${response.status}) : ${details || "réponse vide"}`
                );
              }

              return response.json();
            }
            default:
              throw new Error(`Outil client non pris en charge : ${name}`);
          }
        },
        onError: ({ error }: { error: Error }) => {
          console.groupCollapsed("[ChatKit] onError");
          console.error("error:", error);
          if (lastThreadSnapshotRef.current) {
            console.log("thread snapshot:", lastThreadSnapshotRef.current);
          }
          console.groupEnd();
          setError(error.message);
        },
        onResponseStart: () => {
          setError(null);
        },
        onResponseEnd: () => {
          console.debug("[ChatKit] response end");
        },
        onThreadChange: ({ threadId }: { threadId: string | null }) => {
          console.debug("[ChatKit] thread change", { threadId });
        },
        onThreadLoadStart: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load start", { threadId });
        },
        onThreadLoadEnd: ({ threadId }: { threadId: string }) => {
          console.debug("[ChatKit] thread load end", { threadId });
        },
        onLog: (entry: { name: string; data?: Record<string, unknown> }) => {
          if (entry?.data && typeof entry.data === "object") {
            const data = entry.data as Record<string, unknown>;
            if ("thread" in data && data.thread) {
              lastThreadSnapshotRef.current = data.thread as Record<string, unknown>;
            }
          }
          console.debug("[ChatKit] log", entry.name, entry.data ?? {});
        },
      }) satisfies ChatKitOptions,
    [getClientSecret, openProfileSettings, openSidebar]
  );

  const { control } = useChatKit(chatkitOptions);

  const statusMessage = error ?? (isLoading ? "Initialisation de la session…" : null);

  const statusClassName = [
    "chatkit-status",
    error ? "chatkit-status--error" : "",
    !error && isLoading ? "chatkit-status--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sidebarTabIndex = isSidebarOpen ? 0 : -1;

  const handleScrimPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (isDesktopLayout) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeSidebar();
    },
    [closeSidebar, isDesktopLayout],
  );

  const layoutClassName = [
    "chatkit-layout",
    isSidebarOpen ? "chatkit-layout--sidebar-open" : "",
    isDesktopLayout ? "chatkit-layout--desktop" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const mainInteractionHandlers = useMemo<
    Partial<HTMLAttributes<HTMLDivElement>>
  >(() => {
    if (isDesktopLayout) {
      return {};
    }

    return {
      onClick: handleMainInteraction,
      onPointerDown: handleMainInteraction,
      onTouchStart: handleMainInteraction,
    };
  }, [handleMainInteraction, isDesktopLayout]);

  return (
    <div className={layoutClassName}>
      <aside
        className={`chatkit-sidebar${isSidebarOpen ? " chatkit-sidebar--open" : ""}`}
        aria-labelledby="chatkit-sidebar-title"
        aria-hidden={!isSidebarOpen}
      >
        <header className="chatkit-sidebar__header">
          <h2 id="chatkit-sidebar-title" className="chatkit-sidebar__title">
            Navigation
          </h2>
          <p className="chatkit-sidebar__subtitle">
            Accédez rapidement aux sections principales de la plateforme.
          </p>
        </header>
        <nav className="chatkit-sidebar__nav" aria-label="Menu principal">
          <ul className="chatkit-sidebar__list">
            <li className="chatkit-sidebar__item">
              <button type="button" onClick={handleSidebarHome} tabIndex={sidebarTabIndex}>
                Accueil
              </button>
            </li>
            {user?.is_admin && (
              <li className="chatkit-sidebar__item">
                <button type="button" onClick={handleSidebarAdmin} tabIndex={sidebarTabIndex}>
                  Administration
                </button>
              </li>
            )}
            <li className="chatkit-sidebar__item">
              <button type="button" onClick={handleSidebarSettings} tabIndex={sidebarTabIndex}>
                Paramètres rapides
              </button>
            </li>
            <li className="chatkit-sidebar__item chatkit-sidebar__item--danger">
              <button type="button" onClick={handleSidebarLogout} tabIndex={sidebarTabIndex}>
                Déconnexion
              </button>
            </li>
          </ul>
        </nav>
        <footer className="chatkit-sidebar__footer">
          <button
            type="button"
            className="chatkit-sidebar__close"
            onClick={closeSidebar}
            tabIndex={sidebarTabIndex}
          >
            Fermer
          </button>
        </footer>
      </aside>
      <button
        type="button"
        className={`chatkit-layout__scrim${isSidebarOpen ? " chatkit-layout__scrim--active" : ""}`}
        aria-hidden={!isSidebarOpen || isDesktopLayout}
        aria-label="Fermer la barre latérale"
        onPointerDown={handleScrimPointerDown}
        onClick={() => {
          if (!isDesktopLayout) {
            closeSidebar();
          }
        }}
        tabIndex={isSidebarOpen && !isDesktopLayout ? 0 : -1}
      />
      <div className="chatkit-layout__main" {...mainInteractionHandlers}>
        <div className="chatkit-layout__widget">
          <ChatKit
            control={control}
            className="chatkit-host"
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        {statusMessage && (
          <div className={statusClassName} role="status" aria-live="polite">
            {statusMessage}
          </div>
        )}
      </div>
      {isSettingsModalOpen && (
        <div
          className="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
        >
          <div className="settings-modal__backdrop" onClick={closeProfileSettings} />
          <div className="settings-modal__panel" role="document">
            <header className="settings-modal__header">
              <div>
                <h2 id="settings-modal-title" className="settings-modal__title">
                  Paramètres rapides
                </h2>
                <p className="settings-modal__subtitle">
                  Accédez rapidement aux sections clés de votre espace.
                </p>
              </div>
              <button
                type="button"
                className="settings-modal__close"
                onClick={closeProfileSettings}
                aria-label="Fermer les paramètres"
              >
                ×
              </button>
            </header>
            <nav className="settings-modal__content" aria-label="Menu des paramètres">
              <ul className="settings-modal__list">
                <li className="settings-modal__item">
                  <button type="button" onClick={handleHomeFromModal}>
                    Retour à l'accueil
                  </button>
                </li>
                {user?.is_admin && (
                  <li className="settings-modal__item">
                    <button type="button" onClick={handleGoToAdmin}>
                      Administration
                    </button>
                  </li>
                )}
                <li className="settings-modal__item">
                  <button type="button" onClick={handleLogout} className="settings-modal__item--danger">
                    Déconnexion
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
