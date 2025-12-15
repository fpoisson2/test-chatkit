import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { FeedbackMessages, FormField, FormSection } from "../components";
import { chatkitApi } from "../utils/backend";
import { useI18n } from "../i18n";

import styles from "./AdminModelProvidersPage.module.css";

interface WorkflowGenerationPrompt {
  id: number;
  name: string;
  description: string | null;
  model: string;
  provider_id: string | null;
  provider_slug: string | null;
  developer_message: string;
  reasoning_effort: string;
  verbosity: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PromptFormData {
  name: string;
  description: string;
  model: string;
  provider_id: string;
  provider_slug: string;
  developer_message: string;
  reasoning_effort: string;
  verbosity: string;
  is_default: boolean;
  is_active: boolean;
}

const defaultFormData: PromptFormData = {
  name: "",
  description: "",
  model: "o3",
  provider_id: "",
  provider_slug: "",
  developer_message: "",
  reasoning_effort: "medium",
  verbosity: "medium",
  is_default: false,
  is_active: true,
};

export const AdminWorkflowGenerationPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [editingPrompt, setEditingPrompt] = useState<number | "new" | null>(null);
  const [formData, setFormData] = useState<PromptFormData>(defaultFormData);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch prompts
  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ["workflow-generation-prompts-admin"],
    queryFn: async () => {
      const response = await chatkitApi.get<WorkflowGenerationPrompt[]>(
        "/api/admin/workflow-generation-prompts"
      );
      return response;
    },
    enabled: Boolean(token),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: PromptFormData) => {
      return chatkitApi.post<WorkflowGenerationPrompt>(
        "/api/admin/workflow-generation-prompts",
        {
          name: data.name,
          description: data.description || null,
          model: data.model,
          provider_id: data.provider_id || null,
          provider_slug: data.provider_slug || null,
          developer_message: data.developer_message,
          reasoning_effort: data.reasoning_effort,
          verbosity: data.verbosity,
          is_default: data.is_default,
          is_active: data.is_active,
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-generation-prompts-admin"] });
      setSuccess("Prompt créé avec succès");
      setEditingPrompt(null);
      setFormData(defaultFormData);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: PromptFormData }) => {
      return chatkitApi.patch<WorkflowGenerationPrompt>(
        `/api/admin/workflow-generation-prompts/${id}`,
        {
          name: data.name,
          description: data.description || null,
          model: data.model,
          provider_id: data.provider_id || null,
          provider_slug: data.provider_slug || null,
          developer_message: data.developer_message,
          reasoning_effort: data.reasoning_effort,
          verbosity: data.verbosity,
          is_default: data.is_default,
          is_active: data.is_active,
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-generation-prompts-admin"] });
      setSuccess("Prompt mis à jour avec succès");
      setEditingPrompt(null);
      setFormData(defaultFormData);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await chatkitApi.delete(`/api/admin/workflow-generation-prompts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-generation-prompts-admin"] });
      setSuccess("Prompt supprimé avec succès");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleOpenCreate = useCallback(() => {
    setFormData({
      ...defaultFormData,
      is_default: prompts.length === 0,
    });
    setEditingPrompt("new");
    setError(null);
  }, [prompts.length]);

  const handleOpenEdit = useCallback((prompt: WorkflowGenerationPrompt) => {
    setFormData({
      name: prompt.name,
      description: prompt.description || "",
      model: prompt.model,
      provider_id: prompt.provider_id || "",
      provider_slug: prompt.provider_slug || "",
      developer_message: prompt.developer_message,
      reasoning_effort: prompt.reasoning_effort,
      verbosity: prompt.verbosity,
      is_default: prompt.is_default,
      is_active: prompt.is_active,
    });
    setEditingPrompt(prompt.id);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    setEditingPrompt(null);
    setFormData(defaultFormData);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (editingPrompt === "new") {
        createMutation.mutate(formData);
      } else if (typeof editingPrompt === "number") {
        updateMutation.mutate({ id: editingPrompt, data: formData });
      }
    },
    [editingPrompt, formData, createMutation, updateMutation]
  );

  const handleDelete = useCallback(
    (id: number) => {
      if (window.confirm("Êtes-vous sûr de vouloir supprimer ce prompt ?")) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation]
  );

  const handleFieldChange = useCallback(
    (field: keyof PromptFormData, value: string | boolean) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  if (isLoading) {
    return (
      <div className="admin-content">
        <p>Chargement...</p>
      </div>
    );
  }

  return (
    <div className="admin-content">
      <FeedbackMessages error={error} success={success} />

      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Prompts de génération de workflows
        </h2>
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
          Configurez les prompts système utilisés pour générer automatiquement des workflows avec l'IA.
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleOpenCreate}
        >
          + Nouveau prompt
        </button>
      </div>

      {prompts.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            backgroundColor: "#f9fafb",
            borderRadius: "0.5rem",
            border: "1px dashed #e5e7eb",
          }}
        >
          <p style={{ color: "#6b7280" }}>
            Aucun prompt de génération configuré.
          </p>
          <p style={{ color: "#9ca3af", fontSize: "0.875rem" }}>
            Créez un prompt pour permettre la génération automatique de workflows.
          </p>
        </div>
      ) : (
        <div className={styles.table}>
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Modèle</th>
                <th>Raisonnement</th>
                <th>Défaut</th>
                <th>Actif</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((prompt) => (
                <tr key={prompt.id}>
                  <td>
                    <div>
                      <strong>{prompt.name}</strong>
                      {prompt.description && (
                        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                          {prompt.description}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>{prompt.model}</td>
                  <td>{prompt.reasoning_effort}</td>
                  <td>
                    {prompt.is_default ? (
                      <span style={{ color: "#059669" }}>Oui</span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>Non</span>
                    )}
                  </td>
                  <td>
                    {prompt.is_active ? (
                      <span style={{ color: "#059669" }}>Actif</span>
                    ) : (
                      <span style={{ color: "#dc2626" }}>Inactif</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleOpenEdit(prompt)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: "#dc2626" }}
                        onClick={() => handleDelete(prompt.id)}
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

      {editingPrompt !== null && (
        <Modal
          title={editingPrompt === "new" ? "Nouveau prompt" : "Modifier le prompt"}
          onClose={handleClose}
          footer={
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={handleClose}>
                Annuler
              </button>
              <button
                type="submit"
                form="prompt-form"
                className="btn btn-primary"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? "Enregistrement..."
                  : "Enregistrer"}
              </button>
            </div>
          }
        >
          <form id="prompt-form" onSubmit={handleSubmit}>
            <FormSection title="Informations générales">
              <FormField label="Nom" required>
                <input
                  type="text"
                  className="form-input"
                  value={formData.name}
                  onChange={(e) => handleFieldChange("name", e.target.value)}
                  placeholder="Ex: Générateur pédagogique"
                  required
                />
              </FormField>

              <FormField label="Description">
                <input
                  type="text"
                  className="form-input"
                  value={formData.description}
                  onChange={(e) => handleFieldChange("description", e.target.value)}
                  placeholder="Description courte du prompt"
                />
              </FormField>
            </FormSection>

            <FormSection title="Configuration du modèle">
              <FormField label="Modèle" required>
                <input
                  type="text"
                  className="form-input"
                  value={formData.model}
                  onChange={(e) => handleFieldChange("model", e.target.value)}
                  placeholder="Ex: o3, gpt-4o, etc."
                  required
                />
              </FormField>

              <FormField label="Provider ID (optionnel)">
                <input
                  type="text"
                  className="form-input"
                  value={formData.provider_id}
                  onChange={(e) => handleFieldChange("provider_id", e.target.value)}
                  placeholder="ID du provider configuré"
                />
              </FormField>

              <FormField label="Provider Slug (optionnel)">
                <input
                  type="text"
                  className="form-input"
                  value={formData.provider_slug}
                  onChange={(e) => handleFieldChange("provider_slug", e.target.value)}
                  placeholder="Ex: openai, anthropic"
                />
              </FormField>

              <FormField label="Niveau de raisonnement">
                <select
                  className="form-select"
                  value={formData.reasoning_effort}
                  onChange={(e) => handleFieldChange("reasoning_effort", e.target.value)}
                >
                  <option value="none">Aucun</option>
                  <option value="low">Faible</option>
                  <option value="medium">Moyen</option>
                  <option value="high">Élevé</option>
                </select>
              </FormField>

              <FormField label="Verbosité">
                <select
                  className="form-select"
                  value={formData.verbosity}
                  onChange={(e) => handleFieldChange("verbosity", e.target.value)}
                >
                  <option value="low">Faible</option>
                  <option value="medium">Moyen</option>
                  <option value="high">Élevé</option>
                </select>
              </FormField>
            </FormSection>

            <FormSection title="Message développeur">
              <FormField label="Instructions système" required>
                <textarea
                  className="form-textarea"
                  value={formData.developer_message}
                  onChange={(e) => handleFieldChange("developer_message", e.target.value)}
                  placeholder="Instructions détaillées pour la génération de workflows..."
                  rows={15}
                  required
                  style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                />
              </FormField>
            </FormSection>

            <FormSection title="Paramètres">
              <div style={{ display: "flex", gap: "1.5rem" }}>
                <FormField label="">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={formData.is_default}
                      onChange={(e) => handleFieldChange("is_default", e.target.checked)}
                    />
                    Prompt par défaut
                  </label>
                </FormField>

                <FormField label="">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => handleFieldChange("is_active", e.target.checked)}
                    />
                    Actif
                  </label>
                </FormField>
              </div>
            </FormSection>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default AdminWorkflowGenerationPage;
