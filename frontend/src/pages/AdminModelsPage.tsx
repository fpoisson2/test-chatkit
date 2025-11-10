import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import {
  AppSettings,
  AvailableModel,
  AvailableModelPayload,
  AvailableModelUpdatePayload,
  appSettingsApi,
  isUnauthorizedError,
  modelRegistryApi,
} from "../utils/backend";

const sortModels = (models: AvailableModel[]): AvailableModel[] =>
  [...models].sort((a, b) => a.name.localeCompare(b.name, "fr"));

type ProviderOption = {
  id: string | null;
  slug: string;
  name: string;
  isDefault: boolean;
};

const buildProviderOptions = (settings: AppSettings): ProviderOption[] => {
  const options = new Map<string, ProviderOption>();

  const pushOption = (option: ProviderOption) => {
    const existing = options.get(option.slug);
    if (existing) {
      options.set(option.slug, {
        ...existing,
        id: existing.id ?? option.id,
        name: existing.name || option.name,
        isDefault: existing.isDefault || option.isDefault,
      });
      return;
    }
    options.set(option.slug, option);
  };

  for (const record of settings.model_providers ?? []) {
    const slug = record.provider?.trim().toLowerCase();
    if (!slug) {
      continue;
    }
    pushOption({
      id: record.id ?? null,
      slug,
      name: record.provider,
      isDefault: Boolean(record.is_default),
    });
  }

  const runtimeProvider = settings.model_provider?.trim();
  if (runtimeProvider) {
    const normalized = runtimeProvider.toLowerCase();
    pushOption({
      id: null,
      slug: normalized,
      name: runtimeProvider,
      isDefault: true,
    });
  }

  if (!options.has("openai")) {
    pushOption({
      id: null,
      slug: "openai",
      name: "openai",
      isDefault: runtimeProvider?.toLowerCase() === "openai",
    });
  }

  return Array.from(options.values()).sort((a, b) =>
    (a.name || a.slug).localeCompare(b.name || b.slug, "fr"),
  );
};

type ModelFormState = {
  name: string;
  display_name: string;
  description: string;
  provider_id: string;
  provider_slug: string;
};

const buildDefaultFormState = (
  overrides: Partial<ModelFormState> = {},
): ModelFormState => ({
  name: "",
  display_name: "",
  description: "",
  provider_id: "",
  provider_slug: "",
  ...overrides,
});

const buildFormFromModel = (model: AvailableModel): ModelFormState =>
  buildDefaultFormState({
    name: model.name,
    display_name: model.display_name ?? "",
    description: model.description ?? "",
    provider_id: model.provider_id ?? "",
    provider_slug: model.provider_slug ?? "",
  });

export const AdminModelsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<ModelFormState>(() => buildDefaultFormState());
  const [editingModelId, setEditingModelId] = useState<number | null>(null);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [isLoadingProviders, setLoadingProviders] = useState(false);

  const mergedProviderOptions = useMemo(() => {
    const options = new Map<string, ProviderOption>();
    for (const option of providerOptions) {
      options.set(option.slug, option);
    }
    for (const model of models) {
      if (!model.provider_slug) {
        continue;
      }
      const slug = model.provider_slug.toLowerCase();
      if (!options.has(slug)) {
        options.set(slug, {
          id: model.provider_id ?? null,
          slug,
          name: model.provider_slug,
          isDefault: false,
        });
      }
    }
    return Array.from(options.values()).sort((a, b) =>
      (a.name || a.slug).localeCompare(b.name || b.slug, "fr"),
    );
  }, [models, providerOptions]);

  const resetForm = useCallback((overrides: Partial<ModelFormState> = {}) => {
    setForm(buildDefaultFormState(overrides));
    setEditingModelId(null);
  }, []);

  const isEditing = editingModelId !== null;

  const editingModelName = isEditing
    ? form.name.trim() ||
      models.find((candidate) => candidate.id === editingModelId)?.name ||
      form.name
    : "";

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

  const refreshProviders = useCallback(async () => {
    if (!token) {
      setProviderOptions([]);
      return;
    }
    setLoadingProviders(true);
    try {
      const settings = await appSettingsApi.get(token);
      setProviderOptions(buildProviderOptions(settings));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(t("admin.models.errors.providersLoadFailed"));
    } finally {
      setLoadingProviders(false);
    }
  }, [logout, t, token]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const slug = event.target.value;
    if (!slug) {
      setForm((prev) => ({
        ...prev,
        provider_id: "",
        provider_slug: "",
      }));
      return;
    }
    const option = mergedProviderOptions.find(
      (candidate) => candidate.slug === slug,
    );
    setForm((prev) => ({
      ...prev,
      provider_id: option?.id ?? "",
      provider_slug: slug,
    }));
  };

  const renderProviderOptionLabel = (option: ProviderOption): string => {
    const baseLabel =
      option.slug === "openai"
        ? t("admin.models.form.providerOptionOpenAI")
        : option.name || option.slug;
    if (option.isDefault) {
      return t("admin.models.form.providerOptionWithDefault", {
        provider: baseLabel,
      });
    }
    return baseLabel;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError("Authentification requise pour ajouter un modèle.");
      return;
    }
    setError(null);
    setSuccess(null);

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError(t("admin.models.errors.missingModelId"));
      return;
    }

    const trimmedProviderSlug = form.provider_slug.trim();
    if (!trimmedProviderSlug) {
      setError(t("admin.models.errors.missingProvider"));
      return;
    }

    const normalizedProviderSlug = trimmedProviderSlug.toLowerCase();
    const providerOption = mergedProviderOptions.find(
      (candidate) => candidate.slug === normalizedProviderSlug,
    );
    const providerIdFromOption = providerOption?.id?.trim() ?? null;
    const providerIdFromForm = form.provider_id.trim()
      ? form.provider_id.trim()
      : null;
    const providerId = providerIdFromOption ?? providerIdFromForm;

    const trimmedDisplayName = form.display_name.trim();
    const trimmedDescription = form.description.trim();

    if (editingModelId !== null) {
      const payload: AvailableModelUpdatePayload = {
        name: trimmedName,
        display_name: trimmedDisplayName ? trimmedDisplayName : null,
        description: trimmedDescription ? trimmedDescription : null,
        provider_id: providerId,
        provider_slug: normalizedProviderSlug,
      };

      try {
        const updated = await modelRegistryApi.update(
          token,
          editingModelId,
          payload,
        );
        setModels((prev) =>
          sortModels(
            prev.map((item) => (item.id === updated.id ? updated : item)),
          ),
        );
        resetForm({
          provider_id: updated.provider_id ?? "",
          provider_slug: updated.provider_slug ?? "",
        });
        setSuccess(t("admin.models.feedback.updated", { model: updated.name }));
      } catch (err) {
        if (isUnauthorizedError(err)) {
          logout();
          setError("Session expirée, veuillez vous reconnecter.");
          return;
        }
        setSuccess(null);
        setError(
          err instanceof Error
            ? err.message
            : t("admin.models.errors.updateFailed"),
        );
      }
      return;
    }

    const payload: AvailableModelPayload = {
      name: trimmedName,
      display_name: trimmedDisplayName ? trimmedDisplayName : null,
      description: trimmedDescription ? trimmedDescription : null,
      provider_id: providerId,
      provider_slug: normalizedProviderSlug,
    };

    try {
      const created = await modelRegistryApi.create(token, payload);
      setModels((prev) => sortModels([...prev, created]));
      resetForm({
        provider_id: created.provider_id ?? "",
        provider_slug: created.provider_slug ?? "",
      });
      setSuccess(t("admin.models.feedback.created", { model: created.name }));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setSuccess(null);
      setError(
        err instanceof Error
          ? err.message
          : t("admin.models.errors.createFailed"),
      );
    }
  };

  const handleEdit = (model: AvailableModel) => {
    setEditingModelId(model.id);
    setForm(buildFormFromModel(model));
    setError(null);
    setSuccess(null);
  };

  const handleCancelEdit = () => {
    resetForm({
      provider_id: form.provider_id,
      provider_slug: form.provider_slug,
    });
    setError(null);
    setSuccess(null);
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
      if (editingModelId === model.id) {
        resetForm();
      }
      setSuccess(t("admin.models.feedback.deleted", { model: model.name }));
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
              <h2 className="admin-card__title">
                {isEditing
                  ? t("admin.models.form.editTitle")
                  : t("admin.models.form.createTitle")}
              </h2>
              <p className="admin-card__subtitle">
                {isEditing
                  ? t("admin.models.form.editSubtitle")
                  : t("admin.models.form.createSubtitle")}
              </p>
            </div>
            <form className="admin-form" onSubmit={handleSubmit}>
              {isEditing && (
                <div className="alert alert--info" role="status">
                  {t("admin.models.form.editingNotice", {
                    model: editingModelName,
                  })}
                </div>
              )}
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
                    value={form.display_name}
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
              <label className="label">
                {t("admin.models.form.providerSelectLabel")}
                <select
                  className="input"
                  value={form.provider_slug}
                  onChange={handleProviderChange}
                  disabled={isLoading || isLoadingProviders}
                >
                  <option value="" disabled={isLoadingProviders}>
                    {isLoadingProviders
                      ? t("admin.models.form.providerSelectLoading")
                      : t("admin.models.form.providerSelectPlaceholder")}
                  </option>
                  {mergedProviderOptions.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {renderProviderOptionLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="admin-form__hint">
                {t("admin.models.form.providerSelectHint")}
              </p>
              <label className="label">
                Description (optionnel)
                <textarea
                  className="input"
                  rows={3}
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Ajoutez des notes pour aider les administrateurs."
                />
              </label>
              <div className="admin-form__actions">
                {isEditing && (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={handleCancelEdit}
                  >
                    {t("admin.models.form.cancelEdit")}
                  </button>
                )}
                <button
                  className="button"
                  type="submit"
                  disabled={isLoading || isLoadingProviders}
                >
                  {isEditing
                    ? t("admin.models.form.submitUpdate")
                    : t("admin.models.form.submitCreate")}
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
                        <td data-label="Description">{model.description ?? "—"}</td>
                        <td data-label="Actions">
                          <div className="admin-table__actions">
                            <button
                              type="button"
                              className="button button--ghost button--sm"
                              onClick={() => handleEdit(model)}
                              disabled={isEditing && editingModelId === model.id}
                            >
                              {t("admin.models.table.editAction")}
                            </button>
                            <button
                              type="button"
                              className="button button--ghost button--sm"
                              onClick={() => handleDelete(model)}
                            >
                              {t("admin.models.table.deleteAction")}
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
