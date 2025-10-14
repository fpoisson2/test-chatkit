import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth";
import {
  AccessibleModel,
  AccessibleModelCreatePayload,
  AccessibleModelUpdatePayload,
  adminApi,
  isUnauthorizedError,
} from "../utils/backend";
import { AdminLayout } from "../components/AdminLayout";
import { AdminTabs } from "../components/AdminTabs";

const buildDraftFromModel = (model: AccessibleModel) => ({
  display_name: model.display_name ?? "",
  supports_reasoning: model.supports_reasoning,
});

type ModelDrafts = Record<number, ReturnType<typeof buildDraftFromModel>>;

type CreateDraft = AccessibleModelCreatePayload & { display_name: string };

export const AdminModelsPage = () => {
  const { token, user: currentUser, logout } = useAuth();
  const [models, setModels] = useState<AccessibleModel[]>([]);
  const [drafts, setDrafts] = useState<ModelDrafts>({});
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    name: "",
    display_name: "",
    supports_reasoning: true,
  });
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDrafts = useCallback((items: AccessibleModel[]) => {
    setDrafts(
      items.reduce<ModelDrafts>((acc, item) => {
        acc[item.id] = buildDraftFromModel(item);
        return acc;
      }, {}),
    );
  }, []);

  const fetchModels = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.listModels(token);
      setModels(data);
      refreshDrafts(data);
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
  }, [logout, refreshDrafts, token]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createDraft.name.trim()) {
      return;
    }

    const payload: AccessibleModelCreatePayload = {
      name: createDraft.name,
      display_name: createDraft.display_name.trim() ? createDraft.display_name : undefined,
      supports_reasoning: createDraft.supports_reasoning,
    };

    try {
      const created = await adminApi.createModel(token, payload);
      setModels((prev) => {
        const next = [...prev, created];
        refreshDrafts(next);
        return next;
      });
      setCreateDraft({ name: "", display_name: "", supports_reasoning: true });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const handleDraftChange = (id: number, updater: (draft: ModelDrafts[number]) => ModelDrafts[number]) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: updater(prev[id] ?? { display_name: "", supports_reasoning: true }),
    }));
  };

  const handleUpdate = async (model: AccessibleModel) => {
    const draft = drafts[model.id];
    if (!draft) {
      return;
    }

    const payload: AccessibleModelUpdatePayload = {
      display_name: draft.display_name,
      supports_reasoning: draft.supports_reasoning,
    };

    try {
      const updated = await adminApi.updateModel(token, model.id, payload);
      setModels((prev) => {
        const next = prev.map((item) => (item.id === updated.id ? updated : item));
        refreshDrafts(next);
        return next;
      });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const handleDelete = async (model: AccessibleModel) => {
    if (!window.confirm(`Supprimer le modèle ${model.name} ?`)) {
      return;
    }

    try {
      await adminApi.deleteModel(token, model.id);
      setModels((prev) => {
        const next = prev.filter((item) => item.id !== model.id);
        refreshDrafts(next);
        return next;
      });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Une erreur inattendue est survenue");
    }
  };

  const hasModels = models.length > 0;
  const badge = useMemo(() => {
    const countLabel = models.length ? ` · ${models.length} modèle${models.length > 1 ? "s" : ""}` : "";
    return `${currentUser?.email ?? "Administrateur"}${countLabel}`;
  }, [currentUser?.email, models.length]);

  return (
    <AdminLayout
      title="Modèles disponibles"
      subtitle="Définissez la liste des modèles OpenAI autorisés pour vos workflows ChatKit."
      badge={badge}
      onLogout={logout}
      tabs={<AdminTabs activeTab="models" />}
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
            <h2 className="admin-card__title">Ajouter un modèle</h2>
            <p className="admin-card__subtitle">
              Renseignez un identifiant OpenAI et indiquez s'il prend en charge le raisonnement avancé.
            </p>
          </div>
          <form className="admin-form" onSubmit={handleCreate}>
            <div className="admin-form__row">
              <label className="label">
                Identifiant du modèle
                <input
                  className="input"
                  type="text"
                  required
                  value={createDraft.name}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Ex. gpt-4.1"
                />
              </label>
              <label className="label">
                Nom affiché (optionnel)
                <input
                  className="input"
                  type="text"
                  value={createDraft.display_name}
                  onChange={(event) =>
                    setCreateDraft((prev) => ({ ...prev, display_name: event.target.value }))
                  }
                  placeholder="Nom lisible"
                />
              </label>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={createDraft.supports_reasoning}
                onChange={(event) =>
                  setCreateDraft((prev) => ({ ...prev, supports_reasoning: event.target.checked }))
                }
              />
              Le modèle supporte le mode raisonnement
            </label>
            <div className="admin-form__actions">
              <button className="button" type="submit" disabled={!createDraft.name.trim()}>
                Ajouter
              </button>
            </div>
          </form>
        </section>

        <section className="admin-card">
          <div>
            <h2 className="admin-card__title">Modèles enregistrés</h2>
            <p className="admin-card__subtitle">
              Gérez les libellés visibles dans le workflow builder et précisez les capacités de raisonnement.
            </p>
          </div>
          {isLoading ? (
            <p>Chargement des modèles…</p>
          ) : !hasModels ? (
            <p>Aucun modèle n'est encore configuré.</p>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Identifiant</th>
                    <th>Nom affiché</th>
                    <th>Raisonnement</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const draft = drafts[model.id] ?? buildDraftFromModel(model);
                    const hasChanges =
                      (draft.display_name ?? "") !== (model.display_name ?? "") ||
                      draft.supports_reasoning !== model.supports_reasoning;
                    return (
                      <tr key={model.id}>
                        <td>{model.name}</td>
                        <td>
                          <input
                            className="input"
                            type="text"
                            value={draft.display_name}
                            onChange={(event) =>
                              handleDraftChange(model.id, (current) => ({
                                ...current,
                                display_name: event.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>
                          <label className="checkbox-field" style={{ margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={draft.supports_reasoning}
                              onChange={(event) =>
                                handleDraftChange(model.id, (current) => ({
                                  ...current,
                                  supports_reasoning: event.target.checked,
                                }))
                              }
                            />
                            Supporte le raisonnement
                          </label>
                        </td>
                        <td>
                          <div className="admin-table__actions">
                          <button
                            className="button button--subtle button--sm"
                            type="button"
                            onClick={() => handleUpdate(model)}
                            disabled={!hasChanges}
                          >
                            Enregistrer
                          </button>
                          <button
                            className="button button--danger button--sm"
                            type="button"
                            onClick={() => handleDelete(model)}
                          >
                            Supprimer
                          </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
};
