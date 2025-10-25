import { FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import {
  VoiceSettings,
  isUnauthorizedError,
  voiceSettingsApi,
  telephonyTrunkApi,
  type TelephonyTrunkSettings,
} from "../utils/backend";

type PromptVariableField = {
  id: string;
  key: string;
  value: string;
};

type VoiceSettingsForm = {
  instructions: string;
  model: string;
  voice: string;
  promptId: string;
  promptVersion: string;
  promptVariables: PromptVariableField[];
};

const createPromptField = (key = "", value = ""): PromptVariableField => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
  key,
  value,
});

const buildVoiceForm = (settings: VoiceSettings | null): VoiceSettingsForm => ({
  instructions: settings?.instructions ?? "",
  model: settings?.model ?? "",
  voice: settings?.voice ?? "",
  promptId: settings?.prompt_id ?? "",
  promptVersion: settings?.prompt_version ?? "",
  promptVariables: settings?.prompt_variables
    ? Object.entries(settings.prompt_variables).map(([key, value]) =>
        createPromptField(key, value),
      )
    : [],
});

const EMPTY_VOICE_FORM = buildVoiceForm(null);

type TelephonyTrunkForm = {
  host: string;
  port: string;
  username: string;
  password: string;
};

const buildTrunkForm = (
  settings: TelephonyTrunkSettings | null,
): TelephonyTrunkForm => ({
  host: settings?.sip_bind_host ?? "",
  port: settings?.sip_bind_port ? String(settings.sip_bind_port) : "",
  username: settings?.sip_username ?? "",
  password: settings?.sip_password ?? "",
});

const EMPTY_TRUNK_FORM = buildTrunkForm(null);

export const AdminVoicePage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(
    null,
  );
  const [voiceForm, setVoiceForm] =
    useState<VoiceSettingsForm>(EMPTY_VOICE_FORM);
  const [isVoiceLoading, setVoiceLoading] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSuccess, setVoiceSuccess] = useState<string | null>(null);
  const [trunkSettings, setTrunkSettings] =
    useState<TelephonyTrunkSettings | null>(null);
  const [trunkForm, setTrunkForm] = useState<TelephonyTrunkForm>(
    EMPTY_TRUNK_FORM,
  );
  const [isTrunkLoading, setTrunkLoading] = useState(true);
  const [trunkError, setTrunkError] = useState<string | null>(null);
  const [trunkSuccess, setTrunkSuccess] = useState<string | null>(null);

  const fetchVoiceSettings = useCallback(async () => {
    if (!token) {
      setVoiceSettings(null);
      setVoiceForm(EMPTY_VOICE_FORM);
      setVoiceLoading(false);
      return;
    }
    setVoiceLoading(true);
    setVoiceError(null);
    setVoiceSuccess(null);
    try {
      const data = await voiceSettingsApi.get(token);
      setVoiceSettings(data);
      setVoiceForm(buildVoiceForm(data));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setVoiceError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setVoiceError(
        err instanceof Error
          ? err.message
          : "Impossible de charger les paramètres vocaux.",
      );
    } finally {
      setVoiceLoading(false);
    }
  }, [logout, token]);

  const fetchTrunkSettings = useCallback(async () => {
    if (!token) {
      setTrunkSettings(null);
      setTrunkForm(EMPTY_TRUNK_FORM);
      setTrunkLoading(false);
      return;
    }

    setTrunkLoading(true);
    setTrunkError(null);
    setTrunkSuccess(null);
    try {
      const data = await telephonyTrunkApi.get(token);
      setTrunkSettings(data);
      setTrunkForm(buildTrunkForm(data));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setTrunkError(t("adminVoice.trunk.errors.sessionExpired"));
        return;
      }
      setTrunkError(
        err instanceof Error
          ? err.message
          : t("adminVoice.trunk.errors.loadFailed"),
      );
    } finally {
      setTrunkLoading(false);
    }
  }, [logout, t, token]);

  useEffect(() => {
    void fetchVoiceSettings();
    void fetchTrunkSettings();
  }, [fetchTrunkSettings, fetchVoiceSettings]);

  const handleVoiceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVoiceError(null);
    setVoiceSuccess(null);
    if (!token) {
      setVoiceError(
        "Authentification requise pour mettre à jour le mode voix.",
      );
      return;
    }

    const instructions = voiceForm.instructions.trim();
    if (!instructions) {
      setVoiceError("Renseignez des instructions pour le mode voix.");
      return;
    }

    const model = voiceForm.model.trim();
    if (!model) {
      setVoiceError("Indiquez le modèle Realtime à utiliser.");
      return;
    }

    const voice = voiceForm.voice.trim();
    if (!voice) {
      setVoiceError("Précisez l'identifiant de la voix Realtime.");
      return;
    }

    const promptVariables = voiceForm.promptVariables.reduce<
      Record<string, string>
    >((acc, item) => {
      const key = item.key.trim();
      if (!key) {
        return acc;
      }
      acc[key] = item.value.trim();
      return acc;
    }, {});

    try {
      const updated = await voiceSettingsApi.update(token, {
        instructions,
        model,
        voice,
        prompt_id: voiceForm.promptId.trim() || null,
        prompt_version: voiceForm.promptVersion.trim() || null,
        prompt_variables: promptVariables,
      });
      setVoiceSettings(updated);
      setVoiceForm(buildVoiceForm(updated));
      setVoiceSuccess("Paramètres vocaux enregistrés avec succès.");
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setVoiceError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setVoiceError(
        err instanceof Error
          ? err.message
          : "Impossible d'enregistrer les paramètres vocaux.",
      );
    }
  };

  const handleVoiceReset = () => {
    if (voiceSettings) {
      setVoiceForm(buildVoiceForm(voiceSettings));
    } else {
      setVoiceForm(EMPTY_VOICE_FORM);
    }
    setVoiceError(null);
    setVoiceSuccess(null);
  };

  const handleTrunkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTrunkError(null);
    setTrunkSuccess(null);

    if (!token) {
      setTrunkError(t("adminVoice.trunk.errors.sessionExpired"));
      return;
    }

    const host = trunkForm.host.trim();
    const username = trunkForm.username.trim();
    const password = trunkForm.password.trim();
    const portValue = trunkForm.port.trim();
    let port: number | null = null;
    if (portValue) {
      const parsed = Number(portValue);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        setTrunkError(t("adminVoice.trunk.errors.invalidPort"));
        return;
      }
      port = parsed;
    }

    try {
      const updated = await telephonyTrunkApi.update(token, {
        sip_bind_host: host || null,
        sip_bind_port: port,
        sip_username: username || null,
        sip_password: password || null,
      });
      setTrunkSettings(updated);
      setTrunkForm(buildTrunkForm(updated));
      setTrunkSuccess(t("adminVoice.trunk.success.saved"));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setTrunkError(t("adminVoice.trunk.errors.sessionExpired"));
        return;
      }
      setTrunkError(
        err instanceof Error
          ? err.message
          : t("adminVoice.trunk.errors.saveFailed"),
      );
    }
  };

  const handleTrunkReset = () => {
    if (trunkSettings) {
      setTrunkForm(buildTrunkForm(trunkSettings));
    } else {
      setTrunkForm(EMPTY_TRUNK_FORM);
    }
    setTrunkError(null);
    setTrunkSuccess(null);
  };

  const handleAddPromptVariable = () => {
    setVoiceForm((prev) => ({
      ...prev,
      promptVariables: [...prev.promptVariables, createPromptField()],
    }));
  };

  const handleRemovePromptVariable = (id: string) => {
    setVoiceForm((prev) => ({
      ...prev,
      promptVariables: prev.promptVariables.filter((item) => item.id !== id),
    }));
  };

  const handlePromptVariableChange = (
    id: string,
    field: "key" | "value",
    value: string,
  ) => {
    setVoiceForm((prev) => ({
      ...prev,
      promptVariables: prev.promptVariables.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }));
  };

  return (
    <>
      <AdminTabs activeTab="voice" />
      <ManagementPageLayout>
        {voiceError && <div className="alert alert--danger">{voiceError}</div>}
        {voiceSuccess && (
          <div className="alert alert--success">{voiceSuccess}</div>
        )}
        {trunkError && <div className="alert alert--danger">{trunkError}</div>}
        {trunkSuccess && (
          <div className="alert alert--success">{trunkSuccess}</div>
        )}
        <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Configuration Realtime</h2>
              <p className="admin-card__subtitle">
                Définissez la voix, le modèle et les instructions envoyées lors
                de la création d'une session.
              </p>
              {voiceSettings ? (
                <p className="admin-card__subtitle">
                  Dernière mise à jour :{" "}
                  {new Date(voiceSettings.updated_at).toLocaleString()}
                </p>
              ) : null}
            </div>
            {isVoiceLoading ? (
              <p className="admin-card__subtitle">
                Chargement des paramètres vocaux…
              </p>
            ) : (
              <form className="admin-form" onSubmit={handleVoiceSubmit}>
                <label className="label">
                  Instructions transmises à l'assistant*
                  <textarea
                    className="input"
                    rows={4}
                    required
                    value={voiceForm.instructions}
                    onChange={(event) =>
                      setVoiceForm((prev) => ({
                        ...prev,
                        instructions: event.target.value,
                      }))
                    }
                    placeholder="Donnez des consignes claires, par exemple : 'Accueille l'utilisateur, pose des questions ouvertes et reste concis.'"
                  />
                </label>
                <div className="admin-form__row">
                  <label className="label">
                    Modèle Realtime*
                    <input
                      className="input"
                      type="text"
                      required
                      value={voiceForm.model}
                      onChange={(event) =>
                        setVoiceForm((prev) => ({
                          ...prev,
                          model: event.target.value,
                        }))
                      }
                      placeholder="Ex. gpt-realtime"
                    />
                  </label>
                  <label className="label">
                    Voix Realtime*
                    <input
                      className="input"
                      type="text"
                      required
                      value={voiceForm.voice}
                      onChange={(event) =>
                        setVoiceForm((prev) => ({
                          ...prev,
                          voice: event.target.value,
                        }))
                      }
                      placeholder="Ex. verse"
                    />
                  </label>
                </div>
                <div className="admin-form__row">
                  <label className="label">
                    Identifiant du prompt (optionnel)
                    <input
                      className="input"
                      type="text"
                      value={voiceForm.promptId}
                      onChange={(event) =>
                        setVoiceForm((prev) => ({
                          ...prev,
                          promptId: event.target.value,
                        }))
                      }
                      placeholder="Ex. pmpt_123"
                    />
                  </label>
                  <label className="label">
                    Version du prompt (optionnel)
                    <input
                      className="input"
                      type="text"
                      value={voiceForm.promptVersion}
                      onChange={(event) =>
                        setVoiceForm((prev) => ({
                          ...prev,
                          promptVersion: event.target.value,
                        }))
                      }
                      placeholder="Ex. 89"
                    />
                  </label>
                </div>
                <div>
                  <div className="admin-form__row">
                    <div>
                      <strong>Variables du prompt</strong>
                      <p className="admin-card__subtitle">
                        Définissez des couples clé/valeur injectés lors de la
                        création de la session Realtime.
                      </p>
                    </div>
                  </div>
                  {voiceForm.promptVariables.length === 0 ? (
                    <p className="admin-card__subtitle">
                      Aucune variable définie pour le moment.
                    </p>
                  ) : (
                    voiceForm.promptVariables.map((variable) => (
                      <div key={variable.id} className="admin-form__row">
                        <label className="label">
                          Clé
                          <input
                            className="input"
                            type="text"
                            value={variable.key}
                            onChange={(event) =>
                              handlePromptVariableChange(
                                variable.id,
                                "key",
                                event.target.value,
                              )
                            }
                            placeholder="Ex. city"
                          />
                        </label>
                        <label className="label">
                          Valeur
                          <input
                            className="input"
                            type="text"
                            value={variable.value}
                            onChange={(event) =>
                              handlePromptVariableChange(
                                variable.id,
                                "value",
                                event.target.value,
                              )
                            }
                            placeholder="Ex. Paris"
                          />
                        </label>
                        <div className="admin-form__actions">
                          <button
                            className="button button--ghost button--sm"
                            type="button"
                            onClick={() =>
                              handleRemovePromptVariable(variable.id)
                            }
                          >
                            Retirer
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  <button
                    className="button button--ghost button--sm"
                    type="button"
                    onClick={handleAddPromptVariable}
                    disabled={isVoiceLoading}
                  >
                    Ajouter une variable
                  </button>
                </div>
                <div className="admin-form__actions" style={{ gap: "12px" }}>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={handleVoiceReset}
                    disabled={isVoiceLoading}
                  >
                    Réinitialiser
                  </button>
                  <button
                    className="button"
                    type="submit"
                    disabled={isVoiceLoading}
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            )}
          </section>
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">
                {t("adminVoice.trunk.cardTitle")}
              </h2>
              <p className="admin-card__subtitle">
                {t("adminVoice.trunk.cardDescription")}
              </p>
              {trunkSettings ? (
                <p className="admin-card__subtitle">
                  {t("adminVoice.trunk.lastUpdated", {
                    value: new Date(trunkSettings.updated_at).toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>
            {isTrunkLoading ? (
              <p className="admin-card__subtitle">
                {t("adminVoice.trunk.loading")}
              </p>
            ) : (
              <form className="admin-form" onSubmit={handleTrunkSubmit}>
                <div className="admin-form__row">
                  <label className="label">
                    {t("adminVoice.trunk.hostLabel")}
                    <input
                      className="input"
                      type="text"
                      value={trunkForm.host}
                      onChange={(event) =>
                        setTrunkForm((prev) => ({
                          ...prev,
                          host: event.target.value,
                        }))
                      }
                      placeholder={t("adminVoice.trunk.hostPlaceholder")}
                    />
                    <span className="admin-card__subtitle">
                      {t("adminVoice.trunk.hostHelp")}
                    </span>
                  </label>
                  <label className="label">
                    {t("adminVoice.trunk.portLabel")}
                    <input
                      className="input"
                      type="text"
                      inputMode="numeric"
                      value={trunkForm.port}
                      onChange={(event) =>
                        setTrunkForm((prev) => ({
                          ...prev,
                          port: event.target.value,
                        }))
                      }
                      placeholder={t("adminVoice.trunk.portPlaceholder")}
                    />
                    <span className="admin-card__subtitle">
                      {t("adminVoice.trunk.portHelp")}
                    </span>
                  </label>
                </div>
                <div className="admin-form__row">
                  <label className="label">
                    {t("adminVoice.trunk.usernameLabel")}
                    <input
                      className="input"
                      type="text"
                      value={trunkForm.username}
                      onChange={(event) =>
                        setTrunkForm((prev) => ({
                          ...prev,
                          username: event.target.value,
                        }))
                      }
                      placeholder={t("adminVoice.trunk.usernamePlaceholder")}
                    />
                  </label>
                  <label className="label">
                    {t("adminVoice.trunk.passwordLabel")}
                    <input
                      className="input"
                      type="password"
                      value={trunkForm.password}
                      onChange={(event) =>
                        setTrunkForm((prev) => ({
                          ...prev,
                          password: event.target.value,
                        }))
                      }
                      placeholder={t("adminVoice.trunk.passwordPlaceholder")}
                    />
                  </label>
                </div>
                <div className="admin-form__actions" style={{ gap: "12px" }}>
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={handleTrunkReset}
                    disabled={isTrunkLoading}
                  >
                    {t("adminVoice.trunk.actions.reset")}
                  </button>
                  <button
                    className="button"
                    type="submit"
                    disabled={isTrunkLoading}
                  >
                    {t("adminVoice.trunk.actions.save")}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </ManagementPageLayout>
    </>
  );
};

export default AdminVoicePage;
