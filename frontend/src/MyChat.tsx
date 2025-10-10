import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";
import { SidebarIcon, type SidebarIconName } from "./components/SidebarIcon";
import { getDesktopLayoutPreference, useIsDesktopLayout } from "./hooks/useDesktopLayout";
import { getOrCreateDeviceId } from "./utils/device";

type WeatherToolCall = {
  name: "get_weather";
  params: {
    city: string;
    country?: string | null;
  };
};

type ClientToolCall = WeatherToolCall;

type NavigationItem = {
  key: string;
  label: string;
  icon: SidebarIconName;
  onClick: () => void;
};

const buildNavigationItems = ({
  isAuthenticated,
  isAdmin,
  handleSidebarHome,
  handleSidebarAdmin,
  handleSidebarSettings,
  handleSidebarLogin,
  handleSidebarLogout,
}: {
  isAuthenticated: boolean;
  isAdmin: boolean;
  handleSidebarHome: () => void;
  handleSidebarAdmin: () => void;
  handleSidebarSettings: () => void;
  handleSidebarLogin: () => void;
  handleSidebarLogout: () => void;
}) => {
  const items: NavigationItem[] = [
    {
      key: "home",
      label: "Accueil",
      icon: "home",
      onClick: handleSidebarHome,
    },
  ];

  if (isAdmin) {
    items.push({
      key: "admin",
      label: "Administration",
      icon: "admin",
      onClick: handleSidebarAdmin,
    });
  }

  if (isAuthenticated) {
    items.push(
      {
        key: "settings",
        label: "Paramètres rapides",
        icon: "settings",
        onClick: handleSidebarSettings,
      },
      {
        key: "logout",
        label: "Déconnexion",
        icon: "logout",
        onClick: handleSidebarLogout,
      },
    );
  } else {
    items.push({
      key: "login",
      label: "Connexion",
      icon: "login",
      onClick: handleSidebarLogin,
    });
  }

  return items;
};

const useSidebarInteractions = ({
  isDesktopLayout,
  onInteract,
}: {
  isDesktopLayout: boolean;
  onInteract: () => void;
}) =>
  useMemo<Partial<HTMLAttributes<HTMLDivElement>>>(() => {
    if (isDesktopLayout) {
      return {};
    }

    return {
      onClick: onInteract,
      onPointerDown: onInteract,
      onTouchStart: onInteract,
    };
  }, [isDesktopLayout, onInteract]);

export function MyChat() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const isAuthenticated = Boolean(user);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const isDesktopLayout = useIsDesktopLayout();
  const [isSidebarOpen, setIsSidebarOpen] = useState(getDesktopLayoutPreference);
  const previousIsDesktopRef = useRef(isDesktopLayout);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);

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

  const { apiConfig, attachmentsEnabled } = useMemo<{
    apiConfig: ChatKitOptions["api"];
    attachmentsEnabled: boolean;
  }>(() => {
    const forceHosted =
      import.meta.env.VITE_CHATKIT_FORCE_HOSTED?.trim().toLowerCase() === "true";

    const rawDomainKey = import.meta.env.VITE_CHATKIT_DOMAIN_KEY?.trim();
    const domainKey = rawDomainKey || "domain_pk_localhost_dev";
    const skipDomainVerification =
      import.meta.env.VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION?.trim().toLowerCase() ===
      "true";
    const shouldBypassDomainCheck = skipDomainVerification || !rawDomainKey;
    const explicitCustomUrl = import.meta.env.VITE_CHATKIT_API_URL?.trim();
    const customApiUrl = explicitCustomUrl || "/api/chatkit";
    const useHostedFlow = forceHosted;

    if (useHostedFlow) {
      return {
        apiConfig: { getClientSecret },
        attachmentsEnabled: true,
      };
    }

    const normalizedStrategy = import.meta.env.VITE_CHATKIT_UPLOAD_STRATEGY
      ?.trim()
      .toLowerCase();

    let attachmentsAreEnabled = false;
    let uploadStrategy:
      | { type: "two_phase" }
      | { type: "direct"; uploadUrl: string }
      | undefined;

    if (!normalizedStrategy) {
      console.warn(
        "[ChatKit] VITE_CHATKIT_API_URL détecté sans VITE_CHATKIT_UPLOAD_STRATEGY : les pièces jointes seront désactivées.",
      );
    } else if (normalizedStrategy === "two_phase" || normalizedStrategy === "two-phase") {
      uploadStrategy = { type: "two_phase" };
      attachmentsAreEnabled = true;
    } else if (normalizedStrategy === "direct") {
      const directUploadUrl = import.meta.env.VITE_CHATKIT_DIRECT_UPLOAD_URL?.trim();
      if (directUploadUrl) {
        uploadStrategy = { type: "direct", uploadUrl: directUploadUrl };
        attachmentsAreEnabled = true;
      } else {
        console.warn(
          "[ChatKit] VITE_CHATKIT_UPLOAD_STRATEGY=direct nécessite VITE_CHATKIT_DIRECT_UPLOAD_URL. Les pièces jointes restent désactivées.",
        );
      }
    } else {
      console.warn(
        `[ChatKit] Stratégie d'upload inconnue : "${normalizedStrategy}". Les pièces jointes restent désactivées.`,
      );
    }

    const authFetch: typeof fetch = (resource, init) => {
      const headers = new Headers(init?.headers ?? {});
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (shouldBypassDomainCheck) {
        const target =
          typeof resource === "string"
            ? resource
            : resource instanceof URL
              ? resource.href
              : resource?.url;
        if (typeof target === "string" && target.includes("/domain_keys/verify")) {
          console.info("[ChatKit] Vérification de domaine ignorée (mode développement).");
          return Promise.resolve(
            new Response(
              JSON.stringify({ status: "skipped" }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
      }

      return fetch(resource, {
        ...init,
        headers,
      });
    };

    if (!rawDomainKey) {
      console.info(
        "[ChatKit] VITE_CHATKIT_DOMAIN_KEY non défini : utilisation du jeton de domaine de développement.",
      );
    }

    const customApiConfig = uploadStrategy
      ? ({
          url: customApiUrl,
          fetch: authFetch,
          uploadStrategy,
          ...(domainKey ? { domainKey } : {}),
        } as ChatKitOptions["api"])
      : ({
          url: customApiUrl,
          fetch: authFetch,
          ...(domainKey ? { domainKey } : {}),
        } as ChatKitOptions["api"]);

    return {
      apiConfig: customApiConfig,
      attachmentsEnabled: attachmentsAreEnabled,
    };
  }, [getClientSecret, token]);

  const attachmentsConfig = useMemo(
    () =>
      attachmentsEnabled
        ? {
            enabled: true,
            maxCount: 4,
            maxSize: 10 * 1024 * 1024,
            accept: {
              "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
              "application/pdf": [".pdf"],
              "text/plain": [".txt", ".md"],
            },
          }
        : { enabled: false },
    [attachmentsEnabled],
  );

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
    if (!user) {
      navigate("/login");
      return;
    }
    setIsSettingsModalOpen(true);
  }, [navigate, user]);

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

  const handleSidebarLogin = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    navigate("/login");
  }, [closeSidebar, isDesktopLayout, navigate]);

  const handleSidebarLogout = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    logout();
  }, [closeSidebar, isDesktopLayout, logout]);

  const chatkitOptions = useMemo(
    () =>
      ({
        api: apiConfig,
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
          attachments: attachmentsConfig,
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
                  `Échec de l'appel météo (${response.status}) : ${details || "réponse vide"}`,
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
    [apiConfig, attachmentsConfig, openProfileSettings, openSidebar],
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

  const isSidebarCollapsed = isDesktopLayout && !isSidebarOpen;

  const sidebarTabIndex = isSidebarOpen || isDesktopLayout ? 0 : -1;

  const navigationItems = useMemo(
    () =>
      buildNavigationItems({
        isAuthenticated,
        isAdmin: Boolean(user?.is_admin),
        handleSidebarHome,
        handleSidebarAdmin,
        handleSidebarSettings,
        handleSidebarLogin,
        handleSidebarLogout,
      }),
    [
      isAuthenticated,
      handleSidebarAdmin,
      handleSidebarHome,
      handleSidebarLogout,
      handleSidebarSettings,
      handleSidebarLogin,
      user?.is_admin,
    ],
  );

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

  const mainInteractionHandlers = useSidebarInteractions({
    isDesktopLayout,
    onInteract: handleMainInteraction,
  });

  const sidebarClassName = [
    "chatkit-sidebar",
    isSidebarOpen ? "chatkit-sidebar--open" : "",
    isSidebarCollapsed ? "chatkit-sidebar--collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClassName}>
      <aside
        className={sidebarClassName}
        aria-label="Navigation principale"
        aria-hidden={!isSidebarOpen && !isDesktopLayout}
      >
        <header className="chatkit-sidebar__header">
          <div className="chatkit-sidebar__topline">
            <div className="chatkit-sidebar__brand">
              <SidebarIcon name="logo" className="chatkit-sidebar__logo" />
              <span className="chatkit-sidebar__brand-text">ChatKit Demo</span>
            </div>
            {isSidebarOpen && (
              <button
                type="button"
                className="chatkit-sidebar__dismiss"
                onClick={closeSidebar}
                tabIndex={sidebarTabIndex}
                aria-label="Fermer la barre latérale"
              >
                ×
              </button>
            )}
          </div>
        </header>
        <nav className="chatkit-sidebar__nav" aria-label="Menu principal">
          <ul className="chatkit-sidebar__list">
            {navigationItems.map((item) => (
              <li key={item.key} className="chatkit-sidebar__item">
                <button
                  type="button"
                  onClick={item.onClick}
                  tabIndex={sidebarTabIndex}
                  aria-label={item.label}
                >
                  <SidebarIcon name={item.icon} className="chatkit-sidebar__icon" />
                  <span className="chatkit-sidebar__label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
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
