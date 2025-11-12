import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { FeedbackMessages, FormField, FormSection } from "../components";
import { useI18n } from "../i18n";
import {
  type AppSettingsUpdatePayload,
  type ModelProviderUpdatePayload,
  type ModelProviderProfile,
  isUnauthorizedError,
} from "../utils/backend";
import { useAppSettings, useUpdateAppSettings } from "../hooks";
import {
  singleModelProviderSchema,
  type SingleModelProviderFormData,
} from "../schemas/admin";

export const AdminModelProvidersPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // État
  const [editingProvider, setEditingProvider] = useState<string | 'new' | null>(null); // null, 'new', ou ID du provider
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch settings
  const { data: settings = null, isLoading } = useAppSettings(token);
  const updateSettings = useUpdateAppSettings();

  // React Hook Form pour le modal
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    reset,
    watch,
    setValue,
  } = useForm<SingleModelProviderFormData>({
    resolver: zodResolver(singleModelProviderSchema),
    defaultValues: {
      provider: "",
      apiBase: "",
      apiKey: "",
      isDefault: false,
      deleteStoredKey: false,
    },
  });

  // Liste des fournisseurs depuis settings
  const providers = settings?.model_providers || [];

  // Fonction pour ouvrir le modal de création
  const handleOpenCreate = () => {
    reset({
      provider: "",
      apiBase: "",
      apiKey: "",
      isDefault: providers.length === 0, // Premier fournisseur = default
      deleteStoredKey: false,
    });
    setEditingProvider('new');
  };

  // Fonction pour ouvrir le modal d'édition
  const handleOpenEdit = (provider: ModelProviderProfile) => {
    reset({
      provider: provider.provider,
      apiBase: provider.api_base || "",
      apiKey: "", // Ne pas préremplir pour sécurité
      isDefault: provider.is_default,
      deleteStoredKey: false,
    });
    setEditingProvider(provider.id);
  };

  // Fonction pour créer un nouveau fournisseur
  const handleCreate = async (data: SingleModelProviderFormData) => {
    setError(null);

    try {
      // Créer la nouvelle entrée
      const newProvider: ModelProviderUpdatePayload = {
        provider: data.provider.trim().toLowerCase(),
        api_base: data.apiBase?.trim() || null,
        is_default: data.isDefault,
      };

      if (data.apiKey?.trim()) {
        newProvider.api_key = data.apiKey.trim();
      }

      // Si c'est le nouveau default, désactiver les autres
      const updatedProviders = providers.map(p => ({
        id: p.id,
        provider: p.provider,
        api_base: p.api_base,
        is_default: data.isDefault ? false : p.is_default,
      }));

      // Ajouter le nouveau
      updatedProviders.push(newProvider);

      // Envoyer au backend
      const payload: AppSettingsUpdatePayload = {
        model_providers: updatedProviders,
      };

      await updateSettings.mutateAsync({ token, payload });
      setSuccess("Fournisseur créé avec succès");
      setEditingProvider(null);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : "Erreur lors de la création");
    }
  };

  // Fonction pour modifier un fournisseur
  const handleEdit = async (data: SingleModelProviderFormData) => {
    if (!editingProvider || editingProvider === 'new') return;

    setError(null);

    try {
      // Mettre à jour la liste
      const updatedProviders = providers.map(p => {
        if (p.id !== editingProvider) {
          return {
            id: p.id,
            provider: p.provider,
            api_base: p.api_base,
            is_default: data.isDefault ? false : p.is_default, // Si nouveau default, désactiver les autres
          };
        }

        const updated: ModelProviderUpdatePayload = {
          id: p.id,
          provider: data.provider.trim().toLowerCase(),
          api_base: data.apiBase?.trim() || null,
          is_default: data.isDefault,
        };

        if (data.apiKey?.trim()) {
          updated.api_key = data.apiKey.trim();
        } else if (data.deleteStoredKey && p.has_api_key) {
          updated.delete_api_key = true;
        }

        return updated;
      });

      // Envoyer au backend
      const payload: AppSettingsUpdatePayload = {
        model_providers: updatedProviders,
      };

      await updateSettings.mutateAsync({ token, payload });
      setSuccess("Fournisseur modifié avec succès");
      setEditingProvider(null);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : "Erreur lors de la modification");
    }
  };

  // Fonction pour supprimer un fournisseur
  const handleDelete = async (providerId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce fournisseur ?")) {
      return;
    }

    setError(null);

    try {
      const providerToDelete = providers.find(p => p.id === providerId);

      // Filtrer la liste
      let updatedProviders = providers
        .filter(p => p.id !== providerId)
        .map(p => ({
          id: p.id,
          provider: p.provider,
          api_base: p.api_base,
          is_default: p.is_default,
        }));

      // Si on supprime le default et qu'il reste des providers, mettre le premier en default
      if (providerToDelete?.is_default && updatedProviders.length > 0) {
        updatedProviders[0].is_default = true;
      }

      // Envoyer au backend
      const payload: AppSettingsUpdatePayload = {
        model_providers: updatedProviders,
      };

      await updateSettings.mutateAsync({ token, payload });
      setSuccess("Fournisseur supprimé avec succès");
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : "Erreur lors de la suppression");
    }
  };

  // Gestionnaire de soumission du formulaire
  const handleSubmit = (data: SingleModelProviderFormData) => {
    if (editingProvider === 'new') {
      return handleCreate(data);
    } else {
      return handleEdit(data);
    }
  };

  const currentProvider = editingProvider && editingProvider !== 'new'
    ? providers.find(p => p.id === editingProvider)
    : null;

  return (
    <>
      <FeedbackMessages
        error={error}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <div className="admin-grid">
        <FormSection
          title="Fournisseurs de modèles"
          subtitle="Gérez les fournisseurs de modèles IA pour votre application"
          headerAction={
            <button
              type="button"
              className="management-header__icon-button"
              aria-label="Ajouter un fournisseur"
              title="Ajouter un fournisseur"
              onClick={handleOpenCreate}
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
            <p>Chargement...</p>
          ) : providers.length === 0 ? (
            <p className="admin-card__subtitle">
              Aucun fournisseur configuré. Utilisez le bouton + pour en ajouter un.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {providers.map((provider) => (
                <li
                  key={provider.id}
                  style={{
                    padding: "0.75rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.375rem",
                    marginBottom: "0.5rem",
                    backgroundColor: provider.is_default ? "#f0fdf4" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                    <strong>{provider.provider}</strong>
                    {provider.is_default && (
                      <span style={{
                        fontSize: "0.75rem",
                        padding: "0.125rem 0.5rem",
                        backgroundColor: "#22c55e",
                        color: "white",
                        borderRadius: "9999px"
                      }}>
                        Par défaut
                      </span>
                    )}
                  </div>
                  {provider.api_base && (
                    <div style={{
                      fontSize: "0.875rem",
                      color: "#6b7280",
                      marginBottom: "0.25rem",
                      wordBreak: "break-all"
                    }}>
                      Base URL: {provider.api_base}
                    </div>
                  )}
                  {provider.has_api_key && (
                    <div style={{
                      fontSize: "0.875rem",
                      color: "#6b7280",
                      marginBottom: "0.75rem",
                      wordBreak: "break-all"
                    }}>
                      ✓ Clé API configurée {provider.api_key_hint && `(${provider.api_key_hint})`}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      onClick={() => handleOpenEdit(provider)}
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      className="button button--sm button--danger"
                      onClick={() => handleDelete(provider.id)}
                      disabled={providers.length === 1}
                      title={providers.length === 1 ? "Impossible de supprimer le dernier fournisseur" : "Supprimer ce fournisseur"}
                    >
                      Supprimer
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      </div>

      {editingProvider && (
        <Modal
          title={editingProvider === 'new' ? "Ajouter un fournisseur" : "Modifier un fournisseur"}
          onClose={() => setEditingProvider(null)}
          footer={
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setEditingProvider(null)}
              >
                Annuler
              </button>
              <button
                type="submit"
                form="provider-form"
                className="button"
                disabled={updateSettings.isPending}
              >
                {editingProvider === 'new' ? "Créer" : "Enregistrer"}
              </button>
            </>
          }
        >
          <form id="provider-form" onSubmit={handleFormSubmit(handleSubmit)} className="admin-form">
            <FormField
              label="Nom du fournisseur"
              error={formErrors.provider?.message}
              hint="Ex: openai, anthropic, litellm, etc."
            >
              <input
                type="text"
                className="input"
                {...register("provider")}
                placeholder="openai"
                disabled={updateSettings.isPending}
              />
            </FormField>

            <FormField
              label="Base URL (optionnel)"
              error={formErrors.apiBase?.message}
              hint="URL de base pour les appels API"
            >
              <input
                type="text"
                className="input"
                {...register("apiBase")}
                placeholder="https://api.openai.com/v1"
                disabled={updateSettings.isPending}
              />
            </FormField>

            <FormField
              label="Clé API (optionnel)"
              hint={currentProvider?.has_api_key ? "Laisser vide pour conserver la clé actuelle" : "Laisser vide si configurée via variables d'environnement"}
            >
              <input
                type="password"
                className="input"
                {...register("apiKey")}
                placeholder="sk-..."
                disabled={updateSettings.isPending}
                autoComplete="off"
              />
            </FormField>

            {currentProvider?.has_api_key && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  {...register("deleteStoredKey")}
                  disabled={updateSettings.isPending}
                />
                <span>Supprimer la clé API enregistrée</span>
              </label>
            )}

            <label className="checkbox-field">
              <input
                type="checkbox"
                {...register("isDefault")}
                disabled={updateSettings.isPending}
              />
              <span>Définir comme fournisseur par défaut</span>
            </label>
          </form>
        </Modal>
      )}
    </>
  );
};
