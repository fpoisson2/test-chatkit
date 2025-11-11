import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { ResponsiveTable, type Column, LoadingSpinner, ErrorAlert } from "../components";
import {
  AppSettings,
  AvailableModel,
  AvailableModelPayload,
  AvailableModelUpdatePayload,
  isUnauthorizedError,
} from "../utils/backend";
import {
  useAppSettings,
  useModelsAdmin,
  useCreateModel,
  useUpdateModel,
  useDeleteModel,
} from "../hooks";
import { adminModelSchema, type AdminModelFormData } from "../schemas/admin";

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

const buildDefaultFormState = (
  overrides: Partial<AdminModelFormData> = {},
): AdminModelFormData => ({
  name: "",
  display_name: "",
  description: "",
  provider_id: "",
  provider_slug: "",
  supports_reasoning: false,
  ...overrides,
});

const buildFormFromModel = (model: AvailableModel): AdminModelFormData =>
  buildDefaultFormState({
    name: model.name,
    display_name: model.display_name ?? "",
    description: model.description ?? "",
    provider_id: model.provider_id ?? "",
    provider_slug: model.provider_slug ?? "",
    supports_reasoning: model.supports_reasoning,
  });

export const AdminModelsPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // React Query hooks
  const { data: modelsData = [], isLoading: isLoadingModels, error: modelsError } = useModelsAdmin(token);
  const { data: settings, isLoading: isLoadingProviders } = useAppSettings(token);
  const createModel = useCreateModel();
  const updateModel = useUpdateModel();
  const deleteModel = useDeleteModel();

  // React Hook Form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    watch,
    setValue,
    reset,
  } = useForm<AdminModelFormData>({
    resolver: zodResolver(adminModelSchema),
    defaultValues: buildDefaultFormState(),
  });

  // Local UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<number | null>(null);

  // Watch form values
  const formValues = watch();

  // Derived state
  const models = useMemo(() => sortModels(modelsData), [modelsData]);
  const isLoading = isLoadingModels || isLoadingProviders;
  const providerOptions = useMemo(
    () => (settings ? buildProviderOptions(settings) : []),
    [settings]
  );

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

  // Handle React Query errors
  useEffect(() => {
    if (modelsError) {
      if (isUnauthorizedError(modelsError)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
      } else {
        setError(
          modelsError instanceof Error
            ? modelsError.message
            : "Impossible de charger les modèles disponibles."
        );
      }
    }
  }, [modelsError, logout]);

  const resetForm = useCallback((overrides: Partial<AdminModelFormData> = {}) => {
    reset(buildDefaultFormState(overrides));
    setEditingModelId(null);
  }, [reset]);

  const isEditing = editingModelId !== null;

  const editingModelName = isEditing
    ? formValues.name.trim() ||
      models.find((candidate) => candidate.id === editingModelId)?.name ||
      formValues.name
    : "";

  const isBusy =
    isLoading ||
    createModel.isPending ||
    updateModel.isPending ||
    deleteModel.isPending;

  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const slug = event.target.value;
    if (!slug) {
      setValue("provider_id", "");
      setValue("provider_slug", "");
      return;
    }
    const option = mergedProviderOptions.find(
      (candidate) => candidate.slug === slug,
    );
    setValue("provider_id", option?.id ?? "");
    setValue("provider_slug", slug);
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

  const handleSubmit = async (data: AdminModelFormData) => {
    if (!token) {
      setError("Authentification requise pour ajouter un modèle.");
      return;
    }
    setError(null);
    setSuccess(null);

    const trimmedName = data.name.trim();
    const trimmedProviderSlug = data.provider_slug.trim();
    const normalizedProviderSlug = trimmedProviderSlug.toLowerCase();

    const providerOption = mergedProviderOptions.find(
      (candidate) => candidate.slug === normalizedProviderSlug,
    );
    const providerIdFromOption = providerOption?.id?.trim() ?? null;
    const providerIdFromForm = data.provider_id.trim()
      ? data.provider_id.trim()
      : null;
    const providerId = providerIdFromOption ?? providerIdFromForm;

    const trimmedDisplayName = data.display_name?.trim() || "";
    const trimmedDescription = data.description?.trim() || "";

    if (editingModelId !== null) {
      const payload: AvailableModelUpdatePayload = {
        name: trimmedName,
        display_name: trimmedDisplayName || null,
        description: trimmedDescription || null,
        provider_id: providerId,
        provider_slug: normalizedProviderSlug,
        supports_reasoning: data.supports_reasoning,
      };

      updateModel.mutate(
        { token, id: editingModelId, payload },
        {
          onSuccess: (updated) => {
            resetForm({
              provider_id: updated.provider_id ?? "",
              provider_slug: updated.provider_slug ?? "",
            });
            setSuccess(t("admin.models.feedback.updated", { model: updated.name }));
          },
          onError: (err) => {
            if (isUnauthorizedError(err)) {
              logout();
              setError("Session expirée, veuillez vous reconnecter.");
            } else {
              setError(
                err instanceof Error
                  ? err.message
                  : t("admin.models.errors.updateFailed")
              );
            }
          },
        }
      );
      return;
    }

    const payload: AvailableModelPayload = {
      name: trimmedName,
      display_name: trimmedDisplayName || null,
      description: trimmedDescription || null,
      provider_id: providerId,
      provider_slug: normalizedProviderSlug,
      supports_reasoning: data.supports_reasoning,
    };

    createModel.mutate(
      { token, payload },
      {
        onSuccess: (created) => {
          resetForm({
            provider_id: created.provider_id ?? "",
            provider_slug: created.provider_slug ?? "",
          });
          setSuccess(t("admin.models.feedback.created", { model: created.name }));
        },
        onError: (err) => {
          if (isUnauthorizedError(err)) {
            logout();
            setError("Session expirée, veuillez vous reconnecter.");
          } else {
            setError(
              err instanceof Error
                ? err.message
                : t("admin.models.errors.createFailed")
            );
          }
        },
      }
    );
  };

  const handleEdit = (model: AvailableModel) => {
    setEditingModelId(model.id);
    reset(buildFormFromModel(model));
    setError(null);
    setSuccess(null);
  };

  const handleCancelEdit = () => {
    resetForm({
      provider_id: formValues.provider_id,
      provider_slug: formValues.provider_slug,
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
    deleteModel.mutate(
      { token, id: model.id },
      {
        onSuccess: () => {
          if (editingModelId === model.id) {
            resetForm();
          }
          setSuccess(t("admin.models.feedback.deleted", { model: model.name }));
          setError(null);
        },
        onError: (err) => {
          if (isUnauthorizedError(err)) {
            logout();
            setError("Session expirée, veuillez vous reconnecter.");
          } else {
            setSuccess(null);
            setError(err instanceof Error ? err.message : "Suppression impossible.");
          }
        },
      }
    );
  };

  const modelColumns = useMemo<Column<AvailableModel>[]>(
    () => [
      {
        key: "name",
        label: "Modèle",
        render: (model) => model.name,
      },
      {
        key: "display",
        label: "Affichage",
        render: (model) => model.display_name ?? "—",
      },
      {
        key: "provider",
        label: "Fournisseur",
        render: (model) =>
          model.provider_slug
            ? `${model.provider_slug}${model.provider_id ? ` (${model.provider_id})` : ""}`
            : "—",
      },
      {
        key: "reasoning",
        label: "Raisonnement",
        render: (model) => (model.supports_reasoning ? "Oui" : "Non"),
      },
      {
        key: "description",
        label: "Description",
        render: (model) => model.description ?? "—",
      },
      {
        key: "actions",
        label: "Actions",
        render: (model) => (
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
        ),
      },
    ],
    [editingModelId, handleDelete, handleEdit, isEditing, t],
  );

  return (
    <>
      <AdminTabs activeTab="models" />
      <ManagementPageLayout>
        {error && <ErrorAlert message={error} dismissible onDismiss={() => setError(null)} />}
        {success && <ErrorAlert message={success} type="info" dismissible onDismiss={() => setSuccess(null)} />}

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
            <form className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
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
                    {...register("name")}
                    placeholder={t("admin.models.form.modelIdPlaceholder")}
                  />
                  {formErrors.name && (
                    <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                      {formErrors.name.message}
                    </span>
                  )}
                </label>
                <label className="label">
                  Nom affiché (optionnel)
                  <input
                    className="input"
                    type="text"
                    {...register("display_name")}
                    placeholder="Nom convivial"
                  />
                </label>
              </div>
              <label className="label">
                {t("admin.models.form.providerSelectLabel")}
                <select
                  className="input"
                  {...register("provider_slug")}
                  onChange={handleProviderChange}
                  disabled={isBusy}
                >
                  <option value="">
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
                {formErrors.provider_slug && (
                  <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    {formErrors.provider_slug.message}
                  </span>
                )}
              </label>
              <p className="admin-form__hint">
                {t("admin.models.form.providerSelectHint")}
              </p>
              <label className="label">
                Description (optionnel)
                <textarea
                  className="input"
                  rows={3}
                  {...register("description")}
                  placeholder="Ajoutez des notes pour aider les administrateurs."
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  {...register("supports_reasoning")}
                />
                Modèle de raisonnement (affiche les options avancées dans le workflow builder)
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
                  disabled={isBusy}
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
              <LoadingSpinner text="Chargement des modèles…" />
            ) : models.length === 0 ? (
              <p style={{ color: "#475569" }}>
                Aucun modèle n'est encore enregistré. Ajoutez-en un pour
                alimenter le menu déroulant du workflow builder.
              </p>
            ) : (
              <ResponsiveTable
                columns={modelColumns}
                data={models}
                keyExtractor={(model) => model.id.toString()}
                mobileCardView={true}
              />
            )}
          </section>
        </div>
      </ManagementPageLayout>
    </>
  );
};
