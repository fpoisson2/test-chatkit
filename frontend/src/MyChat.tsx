import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function MyChat() {
  const { token, user, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastThreadSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<
    "navigation" | "profil" | "support"
  >("navigation");
  const navigate = useNavigate();

  const openProfileSettings = useCallback(() => {
    setActiveSettingsSection("navigation");
    setIsSettingsModalOpen(true);
  }, []);

  const closeProfileSettings = useCallback(() => {
    setIsSettingsModalOpen(false);
  }, []);

  const openHomePage = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const goToAdmin = useCallback(() => {
    setIsSettingsModalOpen(false);
    navigate("/admin");
  }, [navigate]);

  const handleLogout = useCallback(() => {
    setIsSettingsModalOpen(false);
    logout();
  }, [logout]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleOpen = () => openProfileSettings();
    const handleClose = () => closeProfileSettings();

    window.addEventListener("chatkit:open-settings", handleOpen);
    window.addEventListener("chatkit:close-settings", handleClose);

    return () => {
      window.removeEventListener("chatkit:open-settings", handleOpen);
      window.removeEventListener("chatkit:close-settings", handleClose);
    };
  }, [closeProfileSettings, openProfileSettings]);

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
            icon: "settings-cog",
            label: "Paramètres",
            onClick: openProfileSettings,
          },
          rightAction: {
            icon: "home",
            label: "Accueil",
            onClick: openHomePage,
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
    [getClientSecret, openHomePage, openProfileSettings]
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
    <div className="chat-fullscreen">
      <ChatKit
        control={control}
        className="chatkit-host"
        style={{ width: "100%", height: "100%" }}
      />
      <div className={statusClassName}>{statusMessage}</div>
      {isSettingsModalOpen && (
        <div className="settings-modal" role="dialog" aria-modal="true">
          <div className="settings-modal__backdrop" onClick={closeProfileSettings} />
          <div className="settings-modal__panel">
            <header className="settings-modal__header">
              <h2 className="settings-modal__title">Paramètres rapides</h2>
              <p className="settings-modal__subtitle">
                Gérez votre expérience ou accédez aux outils d'administration.
              </p>
              <button
                type="button"
                className="settings-modal__close"
                onClick={closeProfileSettings}
                aria-label="Fermer les paramètres"
              >
                ✕
              </button>
            </header>
            <div className="settings-modal__content">
              <nav className="settings-modal__nav" aria-label="Sous-menus des paramètres">
                <button
                  type="button"
                  className={
                    activeSettingsSection === "navigation"
                      ? "settings-modal__nav-button settings-modal__nav-button--active"
                      : "settings-modal__nav-button"
                  }
                  onClick={() => setActiveSettingsSection("navigation")}
                >
                  Navigation
                </button>
                <button
                  type="button"
                  className={
                    activeSettingsSection === "profil"
                      ? "settings-modal__nav-button settings-modal__nav-button--active"
                      : "settings-modal__nav-button"
                  }
                  onClick={() => setActiveSettingsSection("profil")}
                >
                  Profil
                </button>
                <button
                  type="button"
                  className={
                    activeSettingsSection === "support"
                      ? "settings-modal__nav-button settings-modal__nav-button--active"
                      : "settings-modal__nav-button"
                  }
                  onClick={() => setActiveSettingsSection("support")}
                >
                  Support
                </button>
              </nav>
              <section className="settings-modal__details">
                {activeSettingsSection === "navigation" && (
                  <div className="settings-section">
                    <h3>Navigation rapide</h3>
                    <p>
                      Accédez aux pages clés de la démonstration sans quitter la conversation.
                    </p>
                    <div className="settings-section__actions">
                      <button
                        type="button"
                        className="button"
                        onClick={goToAdmin}
                        disabled={!user?.is_admin}
                      >
                        Ouvrir l'administration
                      </button>
                      <button type="button" className="button button--subtle" onClick={openHomePage}>
                        Retour à l'accueil
                      </button>
                    </div>
                    {!user?.is_admin && (
                      <p className="settings-section__hint">
                        Vous devez disposer des droits administrateur pour accéder à cette section.
                      </p>
                    )}
                  </div>
                )}
                {activeSettingsSection === "profil" && (
                  <div className="settings-section">
                    <h3>Profil utilisateur</h3>
                    <p>
                      Connecté en tant que <strong>{user?.email ?? "invité"}</strong>.
                    </p>
                    <p>Pour modifier vos informations, veuillez contacter un administrateur.</p>
                    <button type="button" className="button button--danger" onClick={handleLogout}>
                      Déconnexion
                    </button>
                  </div>
                )}
                {activeSettingsSection === "support" && (
                  <div className="settings-section">
                    <h3>Support &amp; ressources</h3>
                    <ul>
                      <li>Consultez la FAQ intégrée à ChatKit pour démarrer.</li>
                      <li>Besoin d'une assistance ? Contactez l'équipe démo à demo@example.com.</li>
                      <li>Explorez la documentation produit depuis le tableau de bord OpenAI.</li>
                    </ul>
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
