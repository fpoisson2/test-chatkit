import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth";
import { AdminLayout } from "../components/AdminLayout";
import { AdminTabs } from "../components/AdminTabs";
import {
  AvailableModel,
  AvailableModelPayload,
  isUnauthorizedError,
  modelRegistryApi,
} from "../utils/backend";

const sortModels = (models: AvailableModel[]): AvailableModel[] =>
  [...models].sort((a, b) => a.name.localeCompare(b.name, "fr"));

export const AdminModelsPage = () => {
  const { token, user, logout } = useAuth();
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<AvailableModelPayload>({
    name: "",
    display_name: "",
    description: "",
    supports_reasoning: false,
  });

  const refreshModels = useCallback(async () => {
    if (!token) {
      setModels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await modelRegistryApi.listAdmin(token);
      setModels(sortModels(data));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Impossible de charger les modèles disponibles.");
    } finally {
      setLoading(false);
    }
  }, [logout, token]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError("Authentification requise pour ajouter un modèle.");
      return;
    }
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("Indiquez l'identifiant du modèle OpenAI.");
      return;
    }

    const payload: AvailableModelPayload = {
      name: trimmedName,
      display_name: form.display_name?.trim() ? form.display_name.trim() : null,
      description: form.description?.trim() ? form.description.trim() : null,
      supports_reasoning: form.supports_reasoning,
    };

    try {
      const created = await modelRegistryApi.create(token, payload);
      setModels((prev) => sortModels([...prev, created]));
      setForm({ name: "", display_name: "", description: "", supports_reasoning: false });
      setSuccess(`Modèle « ${created.name} » ajouté avec succès.`);
      setError(null);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setSuccess(null);
      setError(err instanceof Error ? err.message : "Impossible d'ajouter le modèle.");
    }
  };

  const handleDelete = async (model: AvailableModel) => {
    if (!token) {
      setError("Authentification requise pour supprimer un modèle.");
      return;
    }
    if (!window.confirm(`Supprimer le modèle « ${model.name} » ?`)) {
      return;
    }
    try {
      await modelRegistryApi.delete(token, model.id);
      setModels((prev) => prev.filter((item) => item.id !== model.id));
      setSuccess(`Modèle « ${model.name} » supprimé.`);
      setError(null);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setSuccess(null);
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  };

  const badge = useMemo(() => {
    const countLabel = models.length ? ` · ${models.length} modèle${models.length > 1 ? "s" : ""}` : "";
    return `${user?.email ?? "Administrateur"}${countLabel}`;
  }, [models.length, user?.email]);

  return (
    <AdminLayout
      title="Gestion des modèles"
      subtitle="Contrôlez les modèles OpenAI que vos équipes peuvent sélectionner dans le workflow builder."
      badge={badge}
      onLogout={logout}
      tabs={<AdminTabs activeTab="models" />}
    >
      {error && <div className="alert alert--danger">{error}</div>}
      {success && <div className="alert alert--success">{success}</div>}

      <div className="admin-grid">
        <section className="admin-card">
          <div>
            <h2 className="admin-card__title">Ajouter un modèle</h2>
            <p className="admin-card__subtitle">
              Déclarez un modèle accessible dans le workflow builder et précisez s'il supporte le raisonnement.
            </p>
          </div>
          <form className="admin-form" onSubmit={handleSubmit}>
            <div className="admin-form__row">
              <label className="label">
                Identifiant du modèle*
                <input
                  className="input"
                  type="text"
                  value={form.name}
                  required
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Ex. gpt-4.1-mini"
                />
              </label>
              <label className="label">
                Nom affiché (optionnel)
                <input
                  className="input"
                  type="text"
                  value={form.display_name ?? ""}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, display_name: event.target.value }))
                  }
                  placeholder="Nom convivial"
                />
              </label>
            </div>
            <label className="label">
              Description (optionnel)
              <textarea
                className="input"
                rows={3}
                value={form.description ?? ""}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Ajoutez des notes pour aider les administrateurs."
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.supports_reasoning}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, supports_reasoning: event.target.checked }))
                }
              />
              Modèle de raisonnement (affiche les options avancées dans le workflow builder)
            </label>
            <div className="admin-form__actions">
              <button className="button" type="submit" disabled={isLoading}>
                Ajouter le modèle
              </button>
            </div>
          </form>
        </section>

        <section className="admin-card">
          <div>
            <h2 className="admin-card__title">Modèles autorisés</h2>
            <p className="admin-card__subtitle">
              Consultez la liste des modèles disponibles et supprimez ceux qui ne doivent plus apparaître dans le workflow builder.
            </p>
          </div>
          {isLoading ? (
            <p style={{ color: "#475569" }}>Chargement des modèles…</p>
          ) : models.length === 0 ? (
            <p style={{ color: "#475569" }}>
              Aucun modèle n'est encore enregistré. Ajoutez-en un pour alimenter le menu déroulant du workflow builder.
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Modèle</th>
                  <th>Affichage</th>
                  <th>Raisonnement</th>
                  <th>Description</th>
                  <th style={{ width: "6rem" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.id}>
                    <td>{model.name}</td>
                    <td>{model.display_name ?? "—"}</td>
                    <td>{model.supports_reasoning ? "Oui" : "Non"}</td>
                    <td>{model.description ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => handleDelete(model)}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AdminLayout>
  );
};
