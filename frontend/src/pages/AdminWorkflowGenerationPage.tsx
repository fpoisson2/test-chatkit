import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Modal } from "../components/Modal";
import {
  ResponsiveTable,
  type Column,
  LoadingSpinner,
  FeedbackMessages,
  FormField,
  FormSection,
} from "../components";
import {
  useWorkflowGenerationPrompts,
  useCreateWorkflowGenerationPrompt,
  useUpdateWorkflowGenerationPrompt,
  useDeleteWorkflowGenerationPrompt,
  type WorkflowGenerationPrompt,
  type WorkflowGenerationPromptPayload,
} from "../hooks";

type FormData = {
  name: string;
  model: string;
  effort: "low" | "medium" | "high";
  verbosity: "low" | "medium" | "high";
  developer_message: string;
};

const defaultFormState: FormData = {
  name: "",
  model: "o3",
  effort: "medium",
  verbosity: "medium",
  developer_message: "",
};

const buildFormFromPrompt = (prompt: WorkflowGenerationPrompt): FormData => ({
  name: prompt.name,
  model: prompt.model,
  effort: prompt.effort,
  verbosity: prompt.verbosity,
  developer_message: prompt.developer_message,
});

export const AdminWorkflowGenerationPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // React Query hooks
  const { data: prompts = [], isLoading, error: promptsError } = useWorkflowGenerationPrompts(token);
  const createPrompt = useCreateWorkflowGenerationPrompt();
  const updatePrompt = useUpdateWorkflowGenerationPrompt();
  const deletePrompt = useDeleteWorkflowGenerationPrompt();

  // React Hook Form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    reset,
  } = useForm<FormData>({
    defaultValues: defaultFormState,
  });

  // Local UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isSaving = createPrompt.isPending || updatePrompt.isPending;
  const isDeleting = deletePrompt.isPending;

  const resetForm = useCallback(() => {
    reset(defaultFormState);
    setEditingId(null);
  }, [reset]);

  const handleCreate = () => {
    resetForm();
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleEdit = (prompt: WorkflowGenerationPrompt) => {
    reset(buildFormFromPrompt(prompt));
    setEditingId(prompt.id);
    setError(null);
    setSuccess(null);
    setIsModalOpen(true);
  };

  const handleDelete = async (prompt: WorkflowGenerationPrompt) => {
    if (!window.confirm(t("admin.workflowGeneration.confirm.delete", { name: prompt.name }))) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await deletePrompt.mutateAsync({ token, id: prompt.id });
      setSuccess(t("admin.workflowGeneration.feedback.deleted", { name: prompt.name }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("admin.workflowGeneration.errors.deleteFailed")
      );
    }
  };

  const handleSubmit = async (data: FormData) => {
    setError(null);
    setSuccess(null);

    const payload: WorkflowGenerationPromptPayload = {
      name: data.name.trim(),
      model: data.model.trim(),
      effort: data.effort,
      verbosity: data.verbosity,
      developer_message: data.developer_message.trim(),
    };

    try {
      if (editingId !== null) {
        await updatePrompt.mutateAsync({ token, id: editingId, payload });
        setSuccess(t("admin.workflowGeneration.feedback.updated", { name: payload.name }));
      } else {
        await createPrompt.mutateAsync({ token, payload });
        setSuccess(t("admin.workflowGeneration.feedback.created", { name: payload.name }));
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("admin.workflowGeneration.errors.saveFailed")
      );
    }
  };

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    resetForm();
  }, [resetForm]);

  const columns = useMemo<Column<WorkflowGenerationPrompt>[]>(
    () => [
      {
        key: "name",
        label: t("admin.workflowGeneration.list.columns.name"),
        render: (prompt) => <strong>{prompt.name}</strong>,
      },
      {
        key: "model",
        label: t("admin.workflowGeneration.list.columns.model"),
        render: (prompt) => <code>{prompt.model}</code>,
      },
      {
        key: "effort",
        label: t("admin.workflowGeneration.list.columns.effort"),
        render: (prompt) => prompt.effort,
      },
      {
        key: "verbosity",
        label: t("admin.workflowGeneration.list.columns.verbosity"),
        render: (prompt) => prompt.verbosity,
      },
      {
        key: "actions",
        label: t("admin.workflowGeneration.list.columns.actions"),
        render: (prompt) => (
          <div className="admin-table__actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => handleEdit(prompt)}
            >
              {t("admin.workflowGeneration.actions.edit")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={isDeleting}
              onClick={() => handleDelete(prompt)}
            >
              {t("admin.workflowGeneration.actions.delete")}
            </button>
          </div>
        ),
      },
    ],
    [handleDelete, handleEdit, isDeleting, t]
  );

  const isEditing = editingId !== null;
  const modalTitle = isEditing
    ? t("admin.workflowGeneration.form.editTitle")
    : t("admin.workflowGeneration.form.createTitle");
  const submitLabel = isEditing
    ? t("admin.workflowGeneration.form.updateSubmit")
    : t("admin.workflowGeneration.form.createSubmit");
  const formId = "admin-workflow-generation-form";

  return (
    <>
      <FeedbackMessages
        error={error || (promptsError instanceof Error ? promptsError.message : null)}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <div className="admin-grid">
        <FormSection
          title={t("admin.workflowGeneration.list.title")}
          subtitle={t("admin.workflowGeneration.list.subtitle")}
          className="admin-card--wide"
          headerAction={
            <button
              type="button"
              className="management-header__icon-button"
              aria-label={t("admin.workflowGeneration.actions.create")}
              title={t("admin.workflowGeneration.actions.create")}
              onClick={handleCreate}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 4v12M4 10h12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          }
        >
          {isLoading ? (
            <LoadingSpinner text={t("admin.workflowGeneration.list.loading")} />
          ) : prompts.length === 0 ? (
            <p className="admin-card__subtitle">{t("admin.workflowGeneration.list.empty")}</p>
          ) : (
            <ResponsiveTable
              columns={columns}
              data={prompts}
              keyExtractor={(prompt) => prompt.id.toString()}
              mobileCardView={true}
            />
          )}
        </FormSection>
      </div>

      {isModalOpen ? (
        <Modal
          title={modalTitle}
          onClose={handleCloseModal}
          size="lg"
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={handleCloseModal}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                form={formId}
                disabled={isSaving}
              >
                {isSaving ? t("common.saving") : submitLabel}
              </button>
            </>
          }
        >
          <form id={formId} className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
            <FormField
              label={t("admin.workflowGeneration.form.nameLabel")}
              error={formErrors.name?.message}
            >
              <input
                className="input"
                type="text"
                {...register("name", { required: "Le nom est requis" })}
                placeholder={t("admin.workflowGeneration.form.namePlaceholder")}
              />
            </FormField>

            <FormField
              label={t("admin.workflowGeneration.form.modelLabel")}
              error={formErrors.model?.message}
            >
              <input
                className="input"
                type="text"
                {...register("model", { required: "Le modele est requis" })}
                placeholder={t("admin.workflowGeneration.form.modelPlaceholder")}
              />
            </FormField>

            <div className="admin-form__row">
              <FormField label={t("admin.workflowGeneration.form.effortLabel")}>
                <select className="input" {...register("effort")}>
                  <option value="low">{t("admin.workflowGeneration.form.effortLow")}</option>
                  <option value="medium">{t("admin.workflowGeneration.form.effortMedium")}</option>
                  <option value="high">{t("admin.workflowGeneration.form.effortHigh")}</option>
                </select>
              </FormField>

              <FormField label={t("admin.workflowGeneration.form.verbosityLabel")}>
                <select className="input" {...register("verbosity")}>
                  <option value="low">{t("admin.workflowGeneration.form.verbosityLow")}</option>
                  <option value="medium">{t("admin.workflowGeneration.form.verbosityMedium")}</option>
                  <option value="high">{t("admin.workflowGeneration.form.verbosityHigh")}</option>
                </select>
              </FormField>
            </div>

            <FormField
              label={t("admin.workflowGeneration.form.developerMessageLabel")}
              error={formErrors.developer_message?.message}
            >
              <textarea
                className="textarea"
                rows={12}
                {...register("developer_message", { required: "Le message developpeur est requis" })}
                placeholder={t("admin.workflowGeneration.form.developerMessagePlaceholder")}
              />
            </FormField>
          </form>
        </Modal>
      ) : null}
    </>
  );
};
