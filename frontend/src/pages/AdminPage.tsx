import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import {
  CreateUserPayload,
  EditableUser,
  VoiceSettings,
  adminApi,
  isUnauthorizedError,
  resetUserPassword,
  voiceSettingsApi,
} from "../utils/backend";
import { AdminLayout } from "../components/AdminLayout";
import { AdminTabs } from "../components/AdminTabs";

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

export const AdminPage = () => {
  const { token, user: currentUser, logout } = useAuth();
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createPayload, setCreatePayload] = useState<CreateUserPayload>({
    email: "",
    password: "",
    is_admin: false,
  });
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [voiceForm, setVoiceForm] = useState<VoiceSettingsForm>(EMPTY_VOICE_FORM);
  const [isVoiceLoading, setVoiceLoading] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSuccess, setVoiceSuccess] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.listUsers(token);
      setUsers(data);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    } finally {
      setLoading(false);
    }
  }, [logout, token]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

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

  useEffect(() => {
    void fetchVoiceSettings();
  }, [fetchVoiceSettings]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createPayload.email || !createPayload.password) {
      return;
    }

    try {
      const created = await adminApi.createUser(token, createPayload);
      setUsers((prev) => [...prev, created]);
      setCreatePayload({ email: "", password: "", is_admin: false });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const handleToggleAdmin = async (editableUser: EditableUser) => {
    try {
      const updated = await adminApi.updateUser(token, editableUser.id, {
        is_admin: !editableUser.is_admin,
      });
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const handleDelete = async (editableUser: EditableUser) => {
    if (!window.confirm(`Supprimer ${editableUser.email} ?`)) {
      return;
    }

    try {
      await adminApi.deleteUser(token, editableUser.id);
      setUsers((prev) => prev.filter((user) => user.id !== editableUser.id));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const handleResetPassword = async (editableUser: EditableUser) => {
    const newPassword = window.prompt(`Nouveau mot de passe pour ${editableUser.email}`);
    if (!newPassword) {
      return;
    }

    try {
      const updated = await resetUserPassword(token, editableUser.id, { password: newPassword });
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const handleVoiceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVoiceError(null);
    setVoiceSuccess(null);
    if (!token) {
      setVoiceError("Authentification requise pour mettre à jour le mode voix.");
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

    const promptVariables = voiceForm.promptVariables.reduce<Record<string, string>>(
      (acc, item) => {
        const key = item.key.trim();
        if (!key) {
          return acc;
        }
        acc[key] = item.value.trim();
        return acc;
      },
      {},
    );

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

  const userCountLabel = users.length
    ? ` · ${users.length} utilisateur${users.length > 1 ? "s" : ""}`
    : "";

  return (
    <AdminLayout
      title="Administration des utilisateurs"
      subtitle="Gérez les accès autorisés au widget ChatKit et pilotez les rôles en un clin d'œil."
      badge={`${currentUser?.email ?? "Administrateur"}${userCountLabel}`}
      onLogout={logout}
      tabs={<AdminTabs activeTab="users" />}
      toolbar={
        <Link className="button button--ghost" to="/admin/workflows">
          Configurer le workflow ChatKit
        </Link>
      }
    >
      {error && <div className="alert alert--danger">{error}</div>}

      <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Créer un utilisateur</h2>
              <p className="admin-card__subtitle">
                Invitez un collaborateur et attribuez-lui un rôle adapté à son usage de ChatKit.
              </p>
            </div>
            <form className="admin-form" onSubmit={handleCreate}>
              <div className="admin-form__row">
                <label className="label">
                  E-mail
                  <input
                    className="input"
                    type="email"
                    required
                    value={createPayload.email}
                    onChange={(event) => setCreatePayload((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="nouvel.utilisateur@example.com"
                  />
                </label>
                <label className="label">
                  Mot de passe temporaire
                  <input
                    className="input"
                    type="text"
                    required
                    value={createPayload.password}
                    onChange={(event) => setCreatePayload((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="Mot de passe temporaire"
                  />
                </label>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={createPayload.is_admin}
                  onChange={(event) =>
                    setCreatePayload((prev) => ({ ...prev, is_admin: event.target.checked }))
                  }
                />
                Administrateur
              </label>
              <div className="admin-form__actions">
                <button className="button" type="submit">
                  Ajouter
                </button>
              </div>
            </form>
          </section>

          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Utilisateurs</h2>
              <p className="admin-card__subtitle">
                Consultez les accès existants et appliquez des actions rapides pour chaque compte.
              </p>
            </div>
            {isLoading ? (
              <p className="admin-card__subtitle">Chargement des utilisateurs…</p>
            ) : users.length === 0 ? (
              <p className="admin-card__subtitle">Aucun utilisateur pour le moment.</p>
            ) : (
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>E-mail</th>
                      <th>Rôle</th>
                      <th>Créé le</th>
                      <th>Mis à jour le</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((editableUser) => (
                      <tr key={editableUser.id}>
                        <td>{editableUser.email}</td>
                        <td>{editableUser.is_admin ? "Administrateur" : "Utilisateur"}</td>
                        <td>{new Date(editableUser.created_at).toLocaleString()}</td>
                        <td>{new Date(editableUser.updated_at).toLocaleString()}</td>
                        <td>
                          <div className="admin-table__actions">
                            <button
                              className="button button--subtle button--sm"
                              type="button"
                              onClick={() => handleToggleAdmin(editableUser)}
                            >
                              {editableUser.is_admin ? "Retirer admin" : "Promouvoir"}
                            </button>
                            <button
                              className="button button--ghost button--sm"
                              type="button"
                              onClick={() => handleResetPassword(editableUser)}
                            >
                              Réinitialiser
                            </button>
                            <button
                              className="button button--danger button--sm"
                              type="button"
                              onClick={() => handleDelete(editableUser)}
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Paramètres du mode voix</h2>
              <p className="admin-card__subtitle">
                Ajustez les instructions Realtime et le prompt associé pour personnaliser
                l'expérience vocale.
              </p>
              {voiceSettings ? (
                <p className="admin-card__subtitle">
                  Dernière mise à jour : {new Date(voiceSettings.updated_at).toLocaleString()}
                </p>
              ) : null}
            </div>
            {voiceError && <div className="alert alert--danger">{voiceError}</div>}
            {voiceSuccess && <div className="alert alert--success">{voiceSuccess}</div>}
            {isVoiceLoading ? (
              <p className="admin-card__subtitle">Chargement des paramètres vocaux…</p>
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
                      setVoiceForm((prev) => ({ ...prev, instructions: event.target.value }))
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
                        setVoiceForm((prev) => ({ ...prev, model: event.target.value }))
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
                        setVoiceForm((prev) => ({ ...prev, voice: event.target.value }))
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
                        setVoiceForm((prev) => ({ ...prev, promptId: event.target.value }))
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
                        setVoiceForm((prev) => ({ ...prev, promptVersion: event.target.value }))
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
                        Définissez des couples clé/valeur injectés lors de la création de la session
                        Realtime.
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
                              handlePromptVariableChange(variable.id, "key", event.target.value)
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
                              handlePromptVariableChange(variable.id, "value", event.target.value)
                            }
                            placeholder="Ex. Paris"
                          />
                        </label>
                        <div className="admin-form__actions">
                          <button
                            className="button button--ghost button--sm"
                            type="button"
                            onClick={() => handleRemovePromptVariable(variable.id)}
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
                  <button className="button" type="submit" disabled={isVoiceLoading}>
                    Enregistrer
                  </button>
                </div>
              </form>
            )}
          </section>
      </div>
    </AdminLayout>
  );
};
