import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import {
  type AppSettings,
  type AppSettingsUpdatePayload,
  appSettingsApi,
  isUnauthorizedError,
} from "../utils/backend";

export const AdminAppSettingsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sipTrunkUri, setSipTrunkUri] = useState("");
  const [sipTrunkUsername, setSipTrunkUsername] = useState("");
  const [sipTrunkPassword, setSipTrunkPassword] = useState("");
  const [sipContactHost, setSipContactHost] = useState("");
  const [sipContactPort, setSipContactPort] = useState("");
  const [sipContactTransport, setSipContactTransport] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [useCustomModelConfig, setUseCustomModelConfig] = useState(false);
  const [modelProviderChoice, setModelProviderChoice] = useState<
    "openai" | "litellm" | "custom"
  >("openai");
  const [customModelProvider, setCustomModelProvider] = useState("");
  const [modelApiBase, setModelApiBase] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [clearModelApiKey, setClearModelApiKey] = useState(false);
  const promptRef = useRef("");
  const modelApiKeyRef = useRef("");
  const tRef = useRef(t);
  const logoutRef = useRef(logout);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  const applySettings = useCallback((data: AppSettings) => {
    setSettings(data);
    const promptValue = data.thread_title_prompt ?? "";
    setPrompt(promptValue);
    promptRef.current = promptValue;
    setSipTrunkUri(data.sip_trunk_uri ?? "");
    setSipTrunkUsername(data.sip_trunk_username ?? "");
    setSipTrunkPassword(data.sip_trunk_password ?? "");
    setSipContactHost(data.sip_contact_host ?? "");
    setSipContactPort(
      data.sip_contact_port != null ? String(data.sip_contact_port) : "",
    );
    setSipContactTransport(data.sip_contact_transport ?? "");
    const provider = (data.model_provider ?? "").trim().toLowerCase();
    if (provider === "openai" || provider === "litellm") {
      setModelProviderChoice(provider);
      setCustomModelProvider("");
    } else {
      setModelProviderChoice("custom");
      setCustomModelProvider(provider);
    }
    setUseCustomModelConfig(
      Boolean(
        data.is_model_provider_overridden || data.is_model_api_base_overridden,
      ),
    );
    setModelApiBase(data.model_api_base ?? "");
    setModelApiKey("");
    modelApiKeyRef.current = "";
    setClearModelApiKey(false);
  }, []);

  const fetchSettings = useCallback(async () => {
    if (!token) {
      setSettings(null);
      setPrompt("");
      promptRef.current = "";
      setSipTrunkUri("");
      setSipTrunkUsername("");
      setSipTrunkPassword("");
      setSipContactHost("");
      setSipContactPort("");
      setSipContactTransport("");
      setModelApiKey("");
      modelApiKeyRef.current = "";
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await appSettingsApi.get(token);
      applySettings(data);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logoutRef.current();
        setError(tRef.current("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : tRef.current("admin.appSettings.errors.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [applySettings, token]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    const trimmed = promptRef.current.trim();
    if (!trimmed) {
      setError(t("admin.appSettings.errors.promptRequired"));
      return;
    }

    setSaving(true);
    try {
      const normalizedHost = sipContactHost.trim();
      const normalizedPort = sipContactPort.trim();
      let portValue: number | null = null;
      if (normalizedPort) {
        const parsed = Number(normalizedPort);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
          setError(t("admin.appSettings.errors.invalidSipPort"));
          setSaving(false);
          return;
        }
        portValue = parsed;
      }

      const normalizedTransport = sipContactTransport.trim().toLowerCase();
      if (
        normalizedTransport &&
        !["udp", "tcp", "tls"].includes(normalizedTransport)
      ) {
        setError(t("admin.appSettings.errors.invalidSipTransport"));
        setSaving(false);
        return;
      }

      const payload: AppSettingsUpdatePayload = {
        thread_title_prompt: trimmed,
        sip_trunk_uri: sipTrunkUri.trim() || null,
        sip_trunk_username: sipTrunkUsername.trim() || null,
        sip_trunk_password: sipTrunkPassword.trim() || null,
        sip_contact_host: normalizedHost || null,
        sip_contact_port: portValue,
        sip_contact_transport: normalizedTransport || null,
      };

      if (useCustomModelConfig) {
        let providerValue: string;
        if (modelProviderChoice === "custom") {
          const customValue = customModelProvider.trim().toLowerCase();
          if (!customValue) {
            setError(t("admin.appSettings.errors.modelProviderRequired"));
            setSaving(false);
            return;
          }
          providerValue = customValue;
        } else {
          providerValue = modelProviderChoice;
        }
        const baseValue = modelApiBase.trim();
        if (!baseValue) {
          setError(t("admin.appSettings.errors.modelApiBaseRequired"));
          setSaving(false);
          return;
        }
        try {
          const parsed = new URL(baseValue);
          if (!/^https?:$/i.test(parsed.protocol)) {
            throw new Error("invalid protocol");
          }
        } catch (error) {
          setError(t("admin.appSettings.errors.invalidModelApiBase"));
          setSaving(false);
          return;
        }
        payload.model_provider = providerValue;
        payload.model_api_base = baseValue.replace(/\/+$/, "");
      } else {
        payload.model_provider = null;
        payload.model_api_base = null;
      }

      const trimmedApiKey = modelApiKeyRef.current.trim();
      if (trimmedApiKey) {
        payload.model_api_key = trimmedApiKey;
      } else if (clearModelApiKey) {
        payload.model_api_key = null;
      }

      const updated = await appSettingsApi.update(token, payload);
      applySettings(updated);
      setSuccess(t("admin.appSettings.success.saved"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : t("admin.appSettings.errors.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("admin.appSettings.errors.sessionExpired"));
      return;
    }

    setSaving(true);
    try {
      const updated = await appSettingsApi.update(token, {
        thread_title_prompt: null,
      });
      applySettings(updated);
      setSuccess(t("admin.appSettings.success.reset"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError(t("admin.appSettings.errors.sessionExpired"));
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : t("admin.appSettings.errors.resetFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const isBusy = isLoading || isSaving;
  const isCustomPrompt = settings?.is_custom_thread_title_prompt ?? false;
  const defaultPrompt = settings?.default_thread_title_prompt ?? "";
  const isKeyManaged = settings?.is_model_api_key_managed ?? false;
  const storedKeyHint = settings?.model_api_key_hint ?? "";
  const effectiveProvider = settings?.model_provider ?? "";
  const effectiveBase = settings?.model_api_base ?? "";

  return (
    <>
      <AdminTabs activeTab="settings" />
      <ManagementPageLayout
        title={t("admin.appSettings.page.title")}
        subtitle={t("admin.appSettings.page.subtitle")}
      >
        {error ? <div className="alert alert--danger">{error}</div> : null}
        {success ? <div className="alert alert--success">{success}</div> : null}

        <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">
                {t("admin.appSettings.threadTitle.cardTitle")}
              </h2>
              <p className="admin-card__subtitle">
                {t("admin.appSettings.threadTitle.cardDescription")}
              </p>
            </div>
            <form className="admin-form" onSubmit={handleSubmit}>
              <div>
                <h3 className="admin-card__title" style={{ marginBottom: "8px" }}>
                  {t("admin.appSettings.model.cardTitle")}
                </h3>
                <p className="admin-card__subtitle">
                  {t("admin.appSettings.model.cardDescription")}
                </p>
              </div>
              <label className="label" htmlFor="model-config-toggle">
                <input
                  id="model-config-toggle"
                  type="checkbox"
                  checked={useCustomModelConfig}
                  onChange={(event) => {
                    setUseCustomModelConfig(event.target.checked);
                    if (!event.target.checked) {
                      setClearModelApiKey(false);
                    }
                  }}
                  disabled={isBusy}
                />
                <span>{t("admin.appSettings.model.enableCustomLabel")}</span>
              </label>
              <p className="admin-form__hint">
                {useCustomModelConfig
                  ? t("admin.appSettings.model.customConfigHint")
                  : t("admin.appSettings.model.environmentSummary", {
                      provider:
                        effectiveProvider ||
                        t("admin.appSettings.model.providerUnknown"),
                      base:
                        effectiveBase ||
                        t("admin.appSettings.model.baseUnknown"),
                    })}
              </p>
              <label className="label" htmlFor="model-provider">
                {t("admin.appSettings.model.providerLabel")}
                <select
                  id="model-provider"
                  className="input"
                  value={modelProviderChoice}
                  onChange={(event) => {
                    const value = event.target.value as
                      | "openai"
                      | "litellm"
                      | "custom";
                    setModelProviderChoice(value);
                    if (value !== "custom") {
                      setCustomModelProvider("");
                    }
                  }}
                  disabled={!useCustomModelConfig || isBusy}
                >
                  <option value="openai">
                    {t("admin.appSettings.model.providerOpenAI")}
                  </option>
                  <option value="litellm">
                    {t("admin.appSettings.model.providerLiteLLM")}
                  </option>
                  <option value="custom">
                    {t("admin.appSettings.model.providerCustom")}
                  </option>
                </select>
              </label>
              {modelProviderChoice === "custom" ? (
                <label className="label" htmlFor="model-provider-custom">
                  {t("admin.appSettings.model.customProviderLabel")}
                  <input
                    id="model-provider-custom"
                    className="input"
                    type="text"
                    value={customModelProvider}
                    onChange={(event) =>
                      setCustomModelProvider(event.target.value)
                    }
                    placeholder={t(
                      "admin.appSettings.model.customProviderPlaceholder",
                    )}
                    disabled={!useCustomModelConfig || isBusy}
                  />
                </label>
              ) : null}
              <label className="label" htmlFor="model-api-base">
                {t("admin.appSettings.model.apiBaseLabel")}
                <input
                  id="model-api-base"
                  className="input"
                  type="text"
                  value={modelApiBase}
                  onChange={(event) => setModelApiBase(event.target.value)}
                  placeholder="https://api.example.com"
                  disabled={!useCustomModelConfig || isBusy}
                />
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.model.apiBaseHint")}
              </p>
              <label className="label" htmlFor="model-api-key">
                {t("admin.appSettings.model.apiKeyLabel")}
                <input
                  id="model-api-key"
                  className="input"
                  type="password"
                  value={modelApiKey}
                  onChange={(event) => {
                    setModelApiKey(event.target.value);
                    modelApiKeyRef.current = event.target.value;
                    if (event.target.value.trim()) {
                      setClearModelApiKey(false);
                    }
                  }}
                  placeholder={t("admin.appSettings.model.apiKeyPlaceholder")}
                  disabled={isBusy}
                  autoComplete="new-password"
                />
              </label>
              <p className="admin-form__hint">
                {isKeyManaged
                  ? t("admin.appSettings.model.apiKeyStoredHint", {
                      hint: storedKeyHint,
                    })
                  : t("admin.appSettings.model.apiKeyHelp")}
              </p>
              {isKeyManaged ? (
                <label className="label" htmlFor="model-api-key-clear">
                  <input
                    id="model-api-key-clear"
                    type="checkbox"
                    checked={clearModelApiKey}
                    onChange={(event) => setClearModelApiKey(event.target.checked)}
                    disabled={isBusy || Boolean(modelApiKey.trim())}
                  />
                  <span>{t("admin.appSettings.model.apiKeyClearLabel")}</span>
                </label>
              ) : null}
              <div className="admin-form__divider" aria-hidden="true" />
              <label className="label" htmlFor="thread-title-prompt">
                {t("admin.appSettings.threadTitle.fieldLabel")}
                <textarea
                  id="thread-title-prompt"
                  name="thread-title-prompt"
                  className="textarea"
                  rows={5}
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    promptRef.current = event.target.value;
                  }}
                  placeholder={t(
                    "admin.appSettings.threadTitle.placeholder",
                  )}
                  disabled={isBusy}
                />
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.threadTitle.hint")}
              </p>
              <p className="admin-form__hint">
                {isCustomPrompt
                  ? t("admin.appSettings.threadTitle.status.custom")
                  : t("admin.appSettings.threadTitle.status.default")}
              </p>
              <div className="admin-form__default-block" aria-live="polite">
                <strong>{t("admin.appSettings.threadTitle.defaultLabel")}</strong>
                <pre>{defaultPrompt}</pre>
              </div>
              <div className="admin-form__divider" aria-hidden="true" />
              <div>
                <h3 className="admin-card__title" style={{ marginBottom: "8px" }}>
                  {t("admin.appSettings.sipTrunk.cardTitle")}
                </h3>
                <p className="admin-card__subtitle">
                  {t("admin.appSettings.sipTrunk.cardDescription")}
                </p>
              </div>
              <label className="label" htmlFor="sip-trunk-uri">
                {t("admin.appSettings.sipTrunk.uriLabel")}
                <input
                  id="sip-trunk-uri"
                  className="input"
                  type="text"
                  value={sipTrunkUri}
                  onChange={(event) => setSipTrunkUri(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.uriPlaceholder")}
                  disabled={isBusy}
                />
              </label>
              <label className="label" htmlFor="sip-trunk-username">
                {t("admin.appSettings.sipTrunk.usernameLabel")}
                <input
                  id="sip-trunk-username"
                  className="input"
                  type="text"
                  value={sipTrunkUsername}
                  onChange={(event) => setSipTrunkUsername(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.usernamePlaceholder")}
                  disabled={isBusy}
                  autoComplete="username"
                />
              </label>
              <label className="label" htmlFor="sip-trunk-password">
                {t("admin.appSettings.sipTrunk.passwordLabel")}
                <input
                  id="sip-trunk-password"
                  className="input"
                  type="password"
                  value={sipTrunkPassword}
                  onChange={(event) => setSipTrunkPassword(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.passwordPlaceholder")}
                  disabled={isBusy}
                  autoComplete="current-password"
                />
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.sipTrunk.passwordHelp")}
              </p>
              <label className="label" htmlFor="sip-contact-host">
                {t("admin.appSettings.sipTrunk.contactHostLabel")}
                <input
                  id="sip-contact-host"
                  className="input"
                  type="text"
                  value={sipContactHost}
                  onChange={(event) => setSipContactHost(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.contactHostPlaceholder")}
                  disabled={isBusy}
                />
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.sipTrunk.contactHostHelp")}
              </p>
              <label className="label" htmlFor="sip-contact-port">
                {t("admin.appSettings.sipTrunk.contactPortLabel")}
                <input
                  id="sip-contact-port"
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={sipContactPort}
                  onChange={(event) => setSipContactPort(event.target.value)}
                  placeholder={t("admin.appSettings.sipTrunk.contactPortPlaceholder")}
                  disabled={isBusy}
                />
              </label>
              <label className="label" htmlFor="sip-contact-transport">
                {t("admin.appSettings.sipTrunk.contactTransportLabel")}
                <select
                  id="sip-contact-transport"
                  className="input"
                  value={sipContactTransport}
                  onChange={(event) => setSipContactTransport(event.target.value)}
                  disabled={isBusy}
                >
                  <option value="">
                    {t("admin.appSettings.sipTrunk.contactTransportOptionDefault")}
                  </option>
                  <option value="udp">
                    {t("admin.appSettings.sipTrunk.contactTransportOptionUdp")}
                  </option>
                  <option value="tcp">
                    {t("admin.appSettings.sipTrunk.contactTransportOptionTcp")}
                  </option>
                  <option value="tls">
                    {t("admin.appSettings.sipTrunk.contactTransportOptionTls")}
                  </option>
                </select>
              </label>
              <p className="admin-form__hint">
                {t("admin.appSettings.sipTrunk.contactTransportHelp")}
              </p>
              <div className="admin-form__actions" style={{ gap: "12px" }}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleReset}
                  disabled={isBusy || !isCustomPrompt}
                >
                  {t("admin.appSettings.actions.reset")}
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={isBusy}
                >
                  {t("admin.appSettings.actions.save")}
                </button>
              </div>
            </form>
          </section>
        </div>
      </ManagementPageLayout>
    </>
  );
};

export default AdminAppSettingsPage;
