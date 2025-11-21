import { useState, useEffect } from "react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { DevToolsScreencast } from "../chatkit/components/DevToolsScreencast";
import { FormSection } from "../components";
import { makeApiEndpointCandidates } from "../utils/backend";

type BrowserSession = {
  token: string;
  debug_url: string;
};

// Helper to make API requests
const makeApiRequest = async (
  path: string,
  options: RequestInit,
  token: string
): Promise<Response> => {
  const candidates = makeApiEndpointCandidates(
    import.meta.env.VITE_BACKEND_URL || "",
    path
  );

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        },
      });
      return response;
    } catch (err) {
      if (candidates.indexOf(url) === candidates.length - 1) {
        throw err;
      }
    }
  }

  throw new Error("All API endpoints failed");
};

export const AdminBrowserTestPage = () => {
  const { token } = useAuth();
  const { t } = useI18n();

  // State
  const [browserSession, setBrowserSession] = useState<BrowserSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [startUrl, setStartUrl] = useState("https://www.google.com");
  const [navigateUrl, setNavigateUrl] = useState("");

  // Clear messages after 5 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  const handleStartBrowser = async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await makeApiRequest(
        "/api/computer/browser/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: startUrl || null,
            width: 1024,
            height: 768,
          }),
        },
        token
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to start browser");
      }

      const data = await response.json();
      setBrowserSession(data);
      setSuccess(t("admin.browserTest.success.started"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start browser");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = async () => {
    if (!token || !browserSession || !navigateUrl) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await makeApiRequest(
        `/api/computer/browser/navigate/${browserSession.token}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: navigateUrl,
          }),
        },
        token
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to navigate");
      }

      setSuccess(t("admin.browserTest.success.navigated"));
      setNavigateUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to navigate");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseBrowser = async () => {
    if (!token || !browserSession) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await makeApiRequest(
        `/api/computer/browser/close/${browserSession.token}`,
        {
          method: "DELETE",
        },
        token
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to close browser");
      }

      setBrowserSession(null);
      setSuccess(t("admin.browserTest.success.closed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close browser");
      // Even if there's an error, clear the session
      setBrowserSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="admin-section">
      <h2 className="admin-section__title">{t("admin.browserTest.title")}</h2>
      <p className="admin-section__description">
        {t("admin.browserTest.description")}
      </p>

      {error && (
        <div className="admin-section__error" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="admin-section__success" role="status">
          {success}
        </div>
      )}

      <FormSection title={t("admin.browserTest.controls.title")}>
        {!browserSession ? (
          <div className="browser-test__start-section">
            <div className="form-field">
              <label className="form-field__label" htmlFor="start-url">
                {t("admin.browserTest.controls.startUrl")}
              </label>
              <input
                id="start-url"
                type="text"
                className="form-field__input"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://www.google.com"
                disabled={isLoading}
              />
            </div>

            <button
              type="button"
              className="button button--primary"
              onClick={handleStartBrowser}
              disabled={isLoading}
            >
              {isLoading
                ? t("common.loading")
                : t("admin.browserTest.controls.startBrowser")}
            </button>
          </div>
        ) : (
          <div className="browser-test__control-section">
            <div className="browser-test__info">
              <p>
                <strong>{t("admin.browserTest.info.status")}:</strong>{" "}
                <span style={{ color: "green" }}>{t("admin.browserTest.info.running")}</span>
              </p>
              <p>
                <strong>{t("admin.browserTest.info.token")}:</strong>{" "}
                <code>{browserSession.token.substring(0, 16)}...</code>
              </p>
            </div>

            <div className="browser-test__navigate">
              <div className="form-field">
                <label className="form-field__label" htmlFor="navigate-url">
                  {t("admin.browserTest.controls.navigateUrl")}
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    id="navigate-url"
                    type="text"
                    className="form-field__input"
                    value={navigateUrl}
                    onChange={(e) => setNavigateUrl(e.target.value)}
                    placeholder="https://example.com"
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && navigateUrl) {
                        handleNavigate();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={handleNavigate}
                    disabled={isLoading || !navigateUrl}
                  >
                    {t("admin.browserTest.controls.navigate")}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="button button--danger"
              onClick={handleCloseBrowser}
              disabled={isLoading}
            >
              {t("admin.browserTest.controls.closeBrowser")}
            </button>
          </div>
        )}
      </FormSection>

      {browserSession && (
        <FormSection title={t("admin.browserTest.preview.title")}>
          <div className="browser-test__preview">
            <p className="admin-section__description">
              {t("admin.browserTest.preview.description")}
            </p>
            <DevToolsScreencast
              debugUrlToken={browserSession.token}
              className="browser-test-screencast"
            />
          </div>
        </FormSection>
      )}

      <style>{`
        .browser-test__start-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .browser-test__control-section {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .browser-test__info {
          padding: 12px;
          background: #f5f5f5;
          border-radius: 4px;
        }

        .browser-test__info p {
          margin: 8px 0;
        }

        .browser-test__info code {
          background: #fff;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 0.9em;
        }

        .browser-test__navigate {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .browser-test__preview {
          margin-top: 16px;
        }

        .button--danger {
          background-color: #dc3545;
          color: white;
        }

        .button--danger:hover:not(:disabled) {
          background-color: #c82333;
        }

        .admin-section__error {
          padding: 12px;
          background-color: #f8d7da;
          border: 1px solid #f5c6cb;
          border-radius: 4px;
          color: #721c24;
          margin-bottom: 16px;
        }

        .admin-section__success {
          padding: 12px;
          background-color: #d4edda;
          border: 1px solid #c3e6cb;
          border-radius: 4px;
          color: #155724;
          margin-bottom: 16px;
        }

        /* Show status and errors for browser test page */
        .browser-test-screencast .chatkit-screencast-header {
          display: block !important;
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 4px;
          margin-bottom: 8px;
          font-size: 13px;
        }

        .browser-test-screencast .chatkit-screencast-error {
          display: block !important;
          padding: 12px;
          background-color: #fff3cd;
          border: 1px solid #ffc107;
          border-radius: 4px;
          color: #856404;
          margin-bottom: 12px;
        }
      `}</style>
    </div>
  );
};
