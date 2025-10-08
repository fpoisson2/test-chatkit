import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChatKit, useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";
import { useNavigate } from "react-router-dom";

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

type SettingsSection = "navigation" | "preferences" | "session";

export function MyChat() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("navigation");
  const [showTips, setShowTips] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const modalTitleId = useId();
  const modalDescriptionId = useId();

  const openSettings = useCallback(() => {
    setActiveSettingsSection("navigation");
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const goHome = useCallback(() => {
    navigate("/");
    closeSettings();
  }, [closeSettings, navigate]);

  const goToAdmin = useCallback(() => {
    navigate("/admin");
    closeSettings();
  }, [closeSettings, navigate]);

  const handleLogout = useCallback(() => {
    closeSettings();
    logout();
  }, [closeSettings, logout]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSettings, isSettingsOpen]);

  const settingsSections = useMemo(
    () => [
      {
        id: "navigation" as const,
        label: "Navigation",
        description: "Accédez rapidement aux différentes sections de l'application.",
      },
      {
        id: "preferences" as const,
        label: "Préférences",
        description: "Personnalisez votre expérience de discussion.",
      },
      {
        id: "session" as const,
        label: "Session",
        description: "Gérez votre session et vos informations utilisateur.",
      },
    ],
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const devWindow = window as typeof window & {
      openChatSettings?: () => void;
    };

    if (import.meta.env.DEV) {
      devWindow.openChatSettings = openSettings;
      return () => {
        delete devWindow.openChatSettings;
      };
    }

    return () => {
      delete devWindow.openChatSettings;
    };
  }, [openSettings]);

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
          title: "Assistant ChatKit",
          subtitle: user ? `Connecté en tant que ${user.email}` : undefined,
          customButtonLeft: {
            icon: "settings-cog",
            label: "Ouvrir les paramètres",
            onClick: openSettings,
          },
          customButtonRight: {
            icon: "home",
            label: "Revenir à l'accueil",
            onClick: goHome,
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
    [getClientSecret, goHome, openSettings, user?.email]
  );

  const { control } = useChatKit(chatkitOptions);

  const statusMessage = error
    ? error
    : isLoading
      ? "Initialisation de la session…"
      : "Votre assistant est prêt à répondre.";

  const statusClassName = [
    "status-banner",
    error ? "status-banner--error" : "",
    !error && isLoading ? "status-banner--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="chat-layout">
      <div className="chat-layout__canvas">
        <ChatKit
          control={control}
          className="chatkit-host"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <div className="chat-layout__status" aria-live="polite">
        <div className={statusClassName}>{statusMessage}</div>
      </div>
      {isSettingsOpen && (
        <div
          className="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          aria-describedby={modalDescriptionId}
        >
          <div className="settings-modal__dialog">
            <header className="settings-modal__header">
              <div className="settings-modal__intro">
                <h2 className="settings-modal__title" id={modalTitleId}>
                  Paramètres de la session
                </h2>
                <p className="settings-modal__subtitle" id={modalDescriptionId}>
                  Configurez l'assistant et accédez aux outils d'administration.
                </p>
              </div>
              <button
                type="button"
                className="settings-modal__close"
                onClick={closeSettings}
                aria-label="Fermer les paramètres"
              >
                ×
              </button>
            </header>
            <div className="settings-modal__body">
              <nav className="settings-modal__menu" aria-label="Sous-menus des paramètres">
                {settingsSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`settings-modal__menu-item${
                      activeSettingsSection === section.id ? " settings-modal__menu-item--active" : ""
                    }`}
                    onClick={() => setActiveSettingsSection(section.id)}
                  >
                    <span className="settings-modal__menu-label">{section.label}</span>
                    <span className="settings-modal__menu-description">{section.description}</span>
                  </button>
                ))}
              </nav>
              <section className="settings-modal__content">
                {activeSettingsSection === "navigation" && (
                  <div className="settings-panel" data-section="navigation">
                    <h3 className="settings-panel__title">Navigation rapide</h3>
                    <p className="settings-panel__description">
                      Utilisez ces raccourcis pour rejoindre les zones principales de l'application sans quitter votre conversation.
                    </p>
                    <div className="settings-panel__actions">
                      <button type="button" className="button" onClick={goHome}>
                        Retour à l'accueil
                      </button>
                      {user?.is_admin ? (
                        <button type="button" className="button button--ghost" onClick={goToAdmin}>
                          Ouvrir l'administration
                        </button>
                      ) : (
                        <p className="settings-panel__helper">
                          Vous n'avez pas accès à l'administration. Contactez un administrateur pour obtenir les droits nécessaires.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {activeSettingsSection === "preferences" && (
                  <div className="settings-panel" data-section="preferences">
                    <h3 className="settings-panel__title">Préférences d'affichage</h3>
                    <p className="settings-panel__description">
                      Ajustez quelques options visuelles pour adapter l'interface à vos habitudes.
                    </p>
                    <div className="settings-panel__option">
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={showTips}
                          onChange={(event) => setShowTips(event.target.checked)}
                        />
                        <span>
                          Afficher les astuces de conversation
                          <small>
                            Lorsque cette option est activée, l'assistant suggère ponctuellement des conseils pour aller plus loin.
                          </small>
                        </span>
                      </label>
                    </div>
                    <div className="settings-panel__option">
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={reduceMotion}
                          onChange={(event) => setReduceMotion(event.target.checked)}
                        />
                        <span>
                          Réduire les animations
                          <small>
                            Limite certains effets de transition afin d'améliorer le confort visuel et l'accessibilité.
                          </small>
                        </span>
                      </label>
                    </div>
                  </div>
                )}
                {activeSettingsSection === "session" && (
                  <div className="settings-panel" data-section="session">
                    <h3 className="settings-panel__title">Informations de session</h3>
                    <p className="settings-panel__description">
                      Retrouvez un résumé de votre connexion actuelle et terminez votre session si nécessaire.
                    </p>
                    <dl className="settings-panel__details">
                      <div>
                        <dt>Utilisateur</dt>
                        <dd>{user?.email ?? "Utilisateur invité"}</dd>
                      </div>
                      <div>
                        <dt>Statut</dt>
                        <dd>{user?.is_admin ? "Administrateur" : "Collaborateur"}</dd>
                      </div>
                    </dl>
                    <div className="settings-panel__actions">
                      <button type="button" className="button button--danger" onClick={handleLogout}>
                        Déconnexion
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
