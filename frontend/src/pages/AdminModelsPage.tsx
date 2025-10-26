import { FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import {
  AvailableModel,
  AvailableModelPayload,
  isUnauthorizedError,
  modelRegistryApi,
} from "../utils/backend";

const sortModels = (models: AvailableModel[]): AvailableModel[] =>
  [...models].sort((a, b) => a.name.localeCompare(b.name, "fr"));

export const AdminModelsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<AvailableModelPayload>({
    name: "",
    display_name: "",
    description: "",
    supports_reasoning: false,
    provider_id: "",
    provider_slug: "",
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
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger les modèles disponibles.",
      );
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
      setError(t("admin.models.errors.missingModelId"));
      return;
    }

      const payload: AvailableModelPayload = {
        name: trimmedName,
        display_name: form.display_name?.trim() ? form.display_name.trim() : null,
        description: form.description?.trim() ? form.description.trim() : null,
        supports_reasoning: form.supports_reasoning,
        provider_id: form.provider_id?.trim()
          ? form.provider_id.trim()
          : null,
        provider_slug: form.provider_slug?.trim()
          ? form.provider_slug.trim().toLowerCase()
          : null,
      };

    try {
      const created = await modelRegistryApi.create(token, payload);
      setModels((prev) => sortModels([...prev, created]));
      setForm({
        name: "",
        display_name: "",
        description: "",
        supports_reasoning: false,
        provider_id: "",
        provider_slug: "",
      });
      setSuccess(`Modèle « ${created.name} » ajouté avec succès.`);
      setError(null);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setSuccess(null);
      setError(
        err instanceof Error ? err.message : "Impossible d'ajouter le modèle.",
      );
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

  return (
    <>
      <AdminTabs activeTab="models" />
      <ManagementPageLayout>
        {error && <div className="alert alert--danger">{error}</div>}
        {success && <div className="alert alert--success">{success}</div>}

        <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Ajouter un modèle</h2>
              <p className="admin-card__subtitle">
                Déclarez un modèle accessible dans le workflow builder et
                précisez s'il supporte le raisonnement.
              </p>
            </div>
            <form className="admin-form" onSubmit={handleSubmit}>
              <div className="admin-form__row">
                <label className="label">
                  {t("admin.models.form.modelIdLabel")}
                  <input
                    className="input"
                    type="text"
                    value={form.name}
                    required
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder={t("admin.models.form.modelIdPlaceholder")}
                  />
                </label>
                <label className="label">
                  Nom affiché (optionnel)
                  <input
                    className="input"
                    type="text"
                    value={form.display_name ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        display_name: event.target.value,
                      }))
                    }
                    placeholder="Nom convivial"
                  />
                </label>
              </div>
              <div className="admin-form__row">
                <label className="label">
                  {t("admin.models.form.providerIdLabel")}
                  <input
                    className="input"
                    type="text"
                    value={form.provider_id ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        provider_id: event.target.value,
                      }))
                    }
                    placeholder={t("admin.models.form.providerIdPlaceholder")}
                  />
                </label>
                <label className="label">
                  {t("admin.models.form.providerSlugLabel")}
                  <input
                    className="input"
                    type="text"
                    value={form.provider_slug ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        provider_slug: event.target.value,
                      }))
                    }
                    placeholder={t("admin.models.form.providerSlugPlaceholder")}
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
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Ajoutez des notes pour aider les administrateurs."
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.supports_reasoning}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      supports_reasoning: event.target.checked,
                    }))
                  }
                />
                Modèle de raisonnement (affiche les options avancées dans le
                workflow builder)
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
                Consultez la liste des modèles disponibles et supprimez ceux qui
                ne doivent plus apparaître dans le workflow builder.
              </p>
            </div>
            {isLoading ? (
              <p style={{ color: "#475569" }}>Chargement des modèles…</p>
            ) : models.length === 0 ? (
              <p style={{ color: "#475569" }}>
                Aucun modèle n'est encore enregistré. Ajoutez-en un pour
                alimenter le menu déroulant du workflow builder.
              </p>
            ) : (
              <div className="admin-table-wrapper">
                <table className="admin-table admin-table--stack">
                  <thead>
                    <tr>
                      <th>Modèle</th>
                      <th>Affichage</th>
                      <th>Fournisseur</th>
                      <th>Raisonnement</th>
                      <th>Description</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.id}>
                        <td data-label="Modèle">{model.name}</td>
                        <td data-label="Affichage">{model.display_name ?? "—"}</td>
                        <td data-label="Fournisseur">
                          {model.provider_slug
                            ? `${model.provider_slug}${model.provider_id ? ` (${model.provider_id})` : ""}`
                            : "—"}
                        </td>
                        <td data-label="Raisonnement">
                          {model.supports_reasoning ? "Oui" : "Non"}
                        </td>
                        <td data-label="Description">{model.description ?? "—"}</td>
                        <td data-label="Actions">
                          <div className="admin-table__actions">
                            <button
                              type="button"
                              className="button button--ghost button--sm"
                              onClick={() => handleDelete(model)}
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
        </div>
      </ManagementPageLayout>
    </>
  );
};
