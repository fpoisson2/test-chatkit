import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";

const DEVICE_ID_STORAGE_KEY = "chatkit-device-id";

const OPENAI_CHATKIT_BASE_URL = "https://api.openai.com/v1/chatkit/";
const CHATKIT_PROXY_PREFIX = "/api/chatkit/proxy/";

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

export function MyChat() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const handleMainClick = useCallback(() => {
    if (isSidebarOpen) {
      closeSidebar();
    }
  }, [closeSidebar, isSidebarOpen]);

  const openProfileSettings = useCallback(() => {
    setIsSettingsModalOpen(true);
  }, []);

  const closeProfileSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  const handleSidebarSettings = useCallback(() => {
    closeSidebar();
    openProfileSettings();
  }, [closeSidebar, openProfileSettings]);

  const goToHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleSidebarHome = useCallback(() => {
    closeSidebar();
    goToHome();
  }, [closeSidebar, goToHome]);

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
    closeSidebar();
    navigate("/admin");
  }, [closeSidebar, navigate]);

  const handleSidebarLogout = useCallback(() => {
    closeSidebar();
    logout();
  }, [closeSidebar, logout]);

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

  return (
    <div className={`chatkit-layout${isSidebarOpen ? " chatkit-layout--sidebar-open" : ""}`}>
      {isSidebarOpen && (
        <aside className="chatkit-sidebar" aria-labelledby="chatkit-sidebar-title">
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
                <button type="button" onClick={handleSidebarHome}>
                  Accueil
                </button>
              </li>
              {user?.is_admin && (
                <li className="chatkit-sidebar__item">
                  <button type="button" onClick={handleSidebarAdmin}>
                    Administration
                  </button>
                </li>
              )}
              <li className="chatkit-sidebar__item">
                <button type="button" onClick={handleSidebarSettings}>
                  Paramètres rapides
                </button>
              </li>
              <li className="chatkit-sidebar__item chatkit-sidebar__item--danger">
                <button type="button" onClick={handleSidebarLogout}>
                  Déconnexion
                </button>
              </li>
            </ul>
          </nav>
          <footer className="chatkit-sidebar__footer">
            <button type="button" className="chatkit-sidebar__close" onClick={closeSidebar}>
              Fermer
            </button>
          </footer>
        </aside>
      )}
      <div className="chatkit-layout__main" onClick={handleMainClick}>
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
