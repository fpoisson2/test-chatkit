import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import { useAuth } from "./auth";
import { SidebarIcon, type SidebarIconName } from "./components/SidebarIcon";
import { getDesktopLayoutPreference, useIsDesktopLayout } from "./hooks/useDesktopLayout";
import { getOrCreateDeviceId } from "./utils/device";
import {
  clearStoredChatKitSecret,
  inferChatKitSessionExpiration,
  persistChatKitSecret,
  readStoredChatKitSession,
} from "./utils/chatkitSession";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import { SettingsModal } from "./features/settings/SettingsModal";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./features/settings/sections";
import { useAdminUsers } from "./features/settings/useAdminUsers";

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
  handleSidebarVoice,
  handleSidebarSettings,
  handleSidebarLogin,
  handleSidebarLogout,
}: {
  isAuthenticated: boolean;
  handleSidebarVoice: () => void;
  handleSidebarSettings: () => void;
  handleSidebarLogin: () => void;
  handleSidebarLogout: () => void;
}) => {
  const items: NavigationItem[] = [];

  if (isAuthenticated) {
    items.push(
      {
        key: "voice",
        label: "Mode voix",
        icon: "voice",
        onClick: handleSidebarVoice,
      },
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

type ApplicationKey = "chat" | "workflows" | "vector-stores" | "widgets";

const APPLICATIONS: {
  key: ApplicationKey;
  label: string;
  path: string;
  requiresAdmin?: boolean;
}[] = [
  { key: "chat", label: "Chat", path: "/" },
  { key: "workflows", label: "Workflow Builder", path: "/workflows", requiresAdmin: true },
  { key: "vector-stores", label: "Vector Store", path: "/vector-stores", requiresAdmin: true },
  { key: "widgets", label: "Widget Library", path: "/widgets", requiresAdmin: true },
];

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
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS[0].id,
  );
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner),
  );
  const isDesktopLayout = useIsDesktopLayout();
  const [isSidebarOpen, setIsSidebarOpen] = useState(getDesktopLayoutPreference);
  const previousIsDesktopRef = useRef(isDesktopLayout);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const lastVisibilityRefreshRef = useRef(0);
  const previousSessionOwnerRef = useRef<string | null>(null);

  const closeProfileSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  const handleSettingsUnauthorized = useCallback(() => {
    closeProfileSettings();
    logout();
  }, [closeProfileSettings, logout]);

  const adminUsers = useAdminUsers({
    token,
    isEnabled: Boolean(user?.is_admin) && isSettingsModalOpen,
    onUnauthorized: handleSettingsUnauthorized,
  });

  useEffect(() => {
    if (isSettingsModalOpen) {
      setActiveSettingsSection(SETTINGS_SECTIONS[0].id);
    }
  }, [isSettingsModalOpen]);

  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;
    if (previousOwner && previousOwner !== sessionOwner) {
      clearStoredChatKitSecret(previousOwner);
      clearStoredThreadId(previousOwner);
    }
    previousSessionOwnerRef.current = sessionOwner;

    const storedThreadId = loadStoredThreadId(sessionOwner);
    setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
  }, [sessionOwner]);

  const getClientSecret = useCallback(async (currentSecret: string | null) => {
    const { session: storedSession, shouldRefresh } = readStoredChatKitSession(sessionOwner);

    if (currentSecret && storedSession && storedSession.secret === currentSecret && !shouldRefresh) {
      return currentSecret;
    }

    if (!currentSecret && storedSession && !shouldRefresh) {
      return storedSession.secret;
    }

    if (storedSession && shouldRefresh) {
      clearStoredChatKitSecret(sessionOwner);
    }

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
        body: JSON.stringify({ user: sessionOwner }),
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

      const expiresAt = inferChatKitSessionExpiration(data);
      persistChatKitSecret(sessionOwner, data.client_secret, expiresAt);

      return data.client_secret;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
      clearStoredChatKitSecret(sessionOwner);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sessionOwner, token]);

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

    const resolveResourceUrl = (resource: Parameters<typeof fetch>[0]): string | null => {
      if (typeof resource === "string") {
        return resource;
      }
      if (resource instanceof URL) {
        return resource.href;
      }
      if (resource && typeof resource === "object" && "url" in resource) {
        const { url } = resource as { url?: string };
        return typeof url === "string" ? url : null;
      }
      return null;
    };

    const buildServerErrorMessage = (
      url: string | null,
      status: number,
      statusText: string,
      details: string | null,
    ) => {
      const baseUrl = url ?? "l'endpoint ChatKit";
      const normalizedText = statusText || "Erreur serveur";
      const mainMessage = `Le serveur ChatKit (${baseUrl}) a renvoyé ${status} ${normalizedText}.`;

      const hint =
        status === 502
          ? " Vérifiez que votre implémentation auto-hébergée est accessible et que la variable VITE_CHATKIT_API_URL pointe vers la bonne URL."
          : "";

      const extraDetails = details ? ` Détails : ${details}` : "";

      return `${mainMessage}${hint}${extraDetails}`.trim();
    };

    const authFetch: typeof fetch = async (resource, init) => {
      const headers = new Headers(init?.headers ?? {});
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const targetUrl = resolveResourceUrl(resource);

      if (shouldBypassDomainCheck && targetUrl?.includes("/domain_keys/verify")) {
        console.info("[ChatKit] Vérification de domaine ignorée (mode développement).");
        return new Response(
          JSON.stringify({ status: "skipped" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      try {
        const response = await fetch(resource, {
          ...init,
          headers,
        });

        if (!response.ok) {
          let responseDetails: string | null = null;
          try {
            responseDetails = await response.clone().text();
          } catch (cloneError) {
            if (import.meta.env.DEV) {
              console.warn("[ChatKit] Impossible de lire le corps de la réponse d'erreur", cloneError);
            }
          }

          const errorMessage = buildServerErrorMessage(
            targetUrl,
            response.status,
            response.statusText,
            responseDetails?.trim() ? responseDetails : null,
          );

          const enhancedError = new Error(errorMessage);
          (enhancedError as Error & { response?: Response }).response = response;
          throw enhancedError;
        }

        return response;
      } catch (err) {
        if (err instanceof TypeError) {
          const connectivityMessage = targetUrl
            ? `Impossible de contacter ${targetUrl}. Vérifiez votre connexion réseau ou la disponibilité du serveur ChatKit.`
            : "Impossible de joindre le serveur ChatKit. Vérifiez votre connexion réseau.";
          throw new Error(connectivityMessage, { cause: err });
        }

        throw err;
      }
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

  const handleSidebarSettings = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    openProfileSettings();
  }, [closeSidebar, isDesktopLayout, openProfileSettings]);

  const goToHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleHomeFromModal = useCallback(() => {
    closeProfileSettings();
    goToHome();
  }, [closeProfileSettings, goToHome]);

  const handleOpenWorkflows = useCallback(() => {
    closeProfileSettings();
    navigate("/workflows");
  }, [closeProfileSettings, navigate]);

  const handleLogout = useCallback(() => {
    closeProfileSettings();
    logout();
  }, [closeProfileSettings, logout]);

  const handleSidebarVoice = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    navigate("/voice");
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

  const handleGoToAdmin = useCallback(() => {
    if (!isDesktopLayout) {
      closeSidebar();
    }
    navigate("/admin");
  }, [closeSidebar, isDesktopLayout, navigate]);

  const chatkitOptions = useMemo(
    () =>
      ({
        api: apiConfig,
        initialThread: initialThreadId,
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
          persistStoredThreadId(sessionOwner, threadId);
          setInitialThreadId((current) => (current === threadId ? current : threadId));
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
    [
      apiConfig,
      attachmentsConfig,
      initialThreadId,
      openProfileSettings,
      openSidebar,
      sessionOwner,
    ],
  );

  const { control, fetchUpdates } = useChatKit(chatkitOptions);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let rafHandle: number | null = null;

    const refreshConversation = () => {
      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < 500) {
        return;
      }
      lastVisibilityRefreshRef.current = now;

      fetchUpdates().catch((err) => {
        if (import.meta.env.DEV) {
          console.warn("[ChatKit] Échec de la synchronisation après retour d'onglet", err);
        }
      });
    };

    const scheduleRefresh = () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = requestAnimationFrame(refreshConversation);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };

    const handleWindowFocus = () => {
      scheduleRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
    };
  }, [fetchUpdates]);

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

  const location = useLocation();

  const availableApplications = useMemo(
    () =>
      APPLICATIONS.filter((application) =>
        application.requiresAdmin ? Boolean(user?.is_admin) : true,
      ),
    [user?.is_admin],
  );

  const activeApplication = useMemo<ApplicationKey>(() => {
    const matchingApplication = availableApplications.find((application) =>
      location.pathname === "/"
        ? application.path === "/"
        : location.pathname.startsWith(application.path),
    );

    return matchingApplication?.key ?? "chat";
  }, [availableApplications, location.pathname]);

  const handleApplicationChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextApplication = availableApplications.find(
        (application) => application.key === event.target.value,
      );

      if (!nextApplication) {
        return;
      }

      if (!isDesktopLayout) {
        closeSidebar();
      }

      navigate(nextApplication.path);
    },
    [availableApplications, closeSidebar, isDesktopLayout, navigate],
  );

  const navigationItems = useMemo(
    () =>
      buildNavigationItems({
        isAuthenticated,
        handleSidebarVoice,
        handleSidebarSettings,
        handleSidebarLogin,
        handleSidebarLogout,
      }),
    [
      isAuthenticated,
      handleSidebarVoice,
      handleSidebarLogout,
      handleSidebarSettings,
      handleSidebarLogin,
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
          <div className="chatkit-sidebar__app-switcher">
            <label htmlFor="chatkit-app-switcher" className="chatkit-sidebar__app-label">
              Applications
            </label>
            <select
              id="chatkit-app-switcher"
              className="chatkit-sidebar__app-select"
              value={activeApplication}
              onChange={handleApplicationChange}
              tabIndex={sidebarTabIndex}
            >
              {availableApplications.map((application) => (
                <option key={application.key} value={application.key}>
                  {application.label}
                </option>
              ))}
            </select>
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
        {user?.is_admin && (
          <footer className="chatkit-sidebar__footer">
            <button
              type="button"
              className="chatkit-sidebar__footer-link"
              onClick={handleGoToAdmin}
              tabIndex={sidebarTabIndex}
            >
              <SidebarIcon name="admin" className="chatkit-sidebar__icon" />
              <span className="chatkit-sidebar__label">Administration</span>
            </button>
          </footer>
        )}
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
      <SettingsModal
        isOpen={isSettingsModalOpen}
        sections={SETTINGS_SECTIONS}
        activeSectionId={activeSettingsSection}
        onSelectSection={setActiveSettingsSection}
        onClose={closeProfileSettings}
        currentUser={user}
        onGoHome={handleHomeFromModal}
        onLogout={handleLogout}
        onOpenWorkflows={handleOpenWorkflows}
        adminUsers={adminUsers}
      />
    </div>
  );
}
