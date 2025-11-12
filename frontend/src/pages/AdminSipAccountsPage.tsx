import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { useI18n } from "../i18n";
import { adminTelephonySchema, type AdminTelephonyFormData } from "../schemas/admin";
import {
  FeedbackMessages,
  FormField,
  FormSection,
  FormActions,
  TableActions,
  ResponsiveTable,
  LoadingSpinner,
  type Column,
} from "../components";
import {
  useSipAccounts,
  useCreateSipAccount,
  useUpdateSipAccount,
  useDeleteSipAccount,
} from "../hooks";
import type { SipAccount } from "../utils/backend";

// ========== Helper Functions ==========

const emptySipAccountForm = (): AdminTelephonyFormData => ({
  label: "",
  trunk_uri: "",
  username: "",
  password: "",
  contact_host: "",
  contact_port: "5060",
  contact_transport: "udp",
  is_default: false,
  is_active: true,
});

// ========== Main Component ==========

export const AdminSipAccountsPage = () => {
  const { token } = useAuth();
  const { t } = useI18n();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // React Query hooks
  const { data: accounts = [], isLoading } = useSipAccounts(token);
  const createMutation = useCreateSipAccount();
  const updateMutation = useUpdateSipAccount();
  const deleteMutation = useDeleteSipAccount();

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);

  // React Hook Form
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
    reset,
  } = useForm<AdminTelephonyFormData>({
    resolver: zodResolver(adminTelephonySchema),
    defaultValues: emptySipAccountForm(),
  });

  // ========== Handlers ==========

  const handleCreateAccount = () => {
    setShowCreateModal(true);
    setIsCreatingAccount(true);
    setEditingAccountId(null);
    reset(emptySipAccountForm());
    setError(null);
    setSuccess(null);
  };

  const handleEditAccount = (account: SipAccount) => {
    setIsCreatingAccount(false);
    setEditingAccountId(account.id);
    reset({
      label: account.label,
      trunk_uri: account.trunk_uri,
      username: account.username || "",
      password: "",
      contact_host: account.contact_host || "",
      contact_port: account.contact_port?.toString() || "5060",
      contact_transport: account.contact_transport || "udp",
      is_default: account.is_default,
      is_active: account.is_active,
    });
    setError(null);
    setSuccess(null);
  };

  const handleCancelAccount = () => {
    setShowCreateModal(false);
    setIsCreatingAccount(false);
    setEditingAccountId(null);
    reset(emptySipAccountForm());
    setError(null);
    setSuccess(null);
  };

  const handleSubmitAccount = async (data: AdminTelephonyFormData) => {
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        label: data.label,
        trunk_uri: data.trunk_uri,
        username: data.username || null,
        password: data.password || null,
        contact_host: data.contact_host || null,
        contact_port: data.contact_port ? parseInt(data.contact_port) : null,
        contact_transport: data.contact_transport,
        is_default: data.is_default,
        is_active: data.is_active,
      };

      if (isCreatingAccount) {
        await createMutation.mutateAsync({ token, payload });
        setSuccess("Compte SIP créé avec succès");
        setShowCreateModal(false);
      } else if (editingAccountId) {
        await updateMutation.mutateAsync({ token, id: editingAccountId, payload });
        setSuccess("Compte SIP mis à jour avec succès");
      }

      if (isCreatingAccount) {
        setIsCreatingAccount(false);
        reset(emptySipAccountForm());
      } else {
        handleCancelAccount();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  };

  const handleDeleteAccount = async (id: number) => {
    setError(null);
    setSuccess(null);

    try {
      await deleteMutation.mutateAsync({ token, id });
      setSuccess("Compte SIP supprimé avec succès");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  };


  // ========== Table Columns ==========

  const columns: Column<SipAccount>[] = [
    {
      key: "label",
      label: "Label",
      render: (account) => (
        <>
          <strong>{account.label}</strong>
          {account.is_default && (
            <span className="badge badge--primary" style={{ marginLeft: "8px" }}>
              Défaut
            </span>
          )}
        </>
      ),
    },
    {
      key: "trunk_uri",
      label: "URI",
      render: (account) => <code>{account.trunk_uri}</code>,
    },
    {
      key: "username",
      label: "Utilisateur",
      render: (account) => account.username || "—",
    },
    {
      key: "transport",
      label: "Transport",
      render: (account) => account.contact_transport?.toUpperCase() || "UDP",
    },
    {
      key: "status",
      label: "Statut",
      render: (account) => (
        <span className={`badge ${account.is_active ? "badge--success" : "badge--secondary"}`}>
          {account.is_active ? "Actif" : "Inactif"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (account) => (
        <TableActions
          onEdit={() => handleEditAccount(account)}
          onDelete={() => handleDeleteAccount(account.id)}
          deleteConfirmMessage={`Êtes-vous sûr de vouloir supprimer le compte "${account.label}" ?`}
        />
      ),
    },
  ];

  // ========== Render ==========

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const showForm = isCreatingAccount || editingAccountId;

  return (
    <>
      <FeedbackMessages
        error={error}
        success={success}
        onDismissError={() => setError(null)}
        onDismissSuccess={() => setSuccess(null)}
      />

      <div className="admin-grid">
        {editingAccountId && (
          <FormSection
            title="Modifier le compte SIP"
            subtitle="Configurez les paramètres de connexion au trunk SIP."
          >
            <form className="admin-form" onSubmit={handleFormSubmit(handleSubmitAccount)}>
              <div className="admin-form__row">
                <FormField
                  label="Label"
                  error={formErrors.label?.message}
                  required
                >
                  <input
                    className="input"
                    type="text"
                    {...register("label")}
                    placeholder="Trunk Principal"
                    disabled={isSaving}
                  />
                </FormField>

                <FormField
                  label="URI SIP"
                  error={formErrors.trunk_uri?.message}
                  hint="Format requis : sip:username@provider.com ou sips:username@provider.com"
                  required
                >
                  <input
                    className="input"
                    type="text"
                    {...register("trunk_uri")}
                    placeholder="sip:username@provider.com"
                    disabled={isSaving}
                  />
                </FormField>
              </div>

              <div className="admin-form__row">
                <FormField label="Nom d'utilisateur">
                  <input
                    className="input"
                    type="text"
                    {...register("username")}
                    disabled={isSaving}
                  />
                </FormField>

                <FormField
                  label="Mot de passe"
                  hint={editingAccountId ? "(laisser vide pour ne pas changer)" : undefined}
                >
                  <input
                    className="input"
                    type="password"
                    {...register("password")}
                    disabled={isSaving}
                  />
                </FormField>
              </div>

              <div className="admin-form__divider" />

              <div className="admin-form__row">
                <FormField label="Hôte de contact">
                  <input
                    className="input"
                    type="text"
                    {...register("contact_host")}
                    placeholder="votre-ip-publique.com"
                    disabled={isSaving}
                  />
                </FormField>

                <FormField
                  label="Port de contact"
                  error={formErrors.contact_port?.message}
                >
                  <input
                    className="input"
                    type="text"
                    {...register("contact_port")}
                    placeholder="5060"
                    disabled={isSaving}
                  />
                </FormField>

                <FormField label="Transport">
                  <select
                    className="input"
                    {...register("contact_transport")}
                    disabled={isSaving}
                  >
                    <option value="udp">UDP</option>
                    <option value="tcp">TCP</option>
                    <option value="tls">TLS</option>
                  </select>
                </FormField>
              </div>

              <div className="admin-form__divider" />

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  {...register("is_default")}
                  disabled={isSaving}
                />
                Compte par défaut
              </label>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  {...register("is_active")}
                  disabled={isSaving}
                />
                Actif
              </label>

              <FormActions
                submitLabel={isCreatingAccount ? "Créer le compte" : "Enregistrer"}
                onCancel={handleCancelAccount}
                isSubmitting={isSaving}
                showCancel
              />
            </form>
          </FormSection>
        )}

        <FormSection
            title="Comptes SIP"
            subtitle="Gérez les comptes SIP pour connecter ChatKit à vos trunks téléphoniques. Chaque compte peut être associé à des workflows spécifiques."
            headerAction={
              <button
                type="button"
                className="management-header__icon-button"
                aria-label="Ajouter un compte SIP"
                title="Ajouter un compte SIP"
                onClick={handleCreateAccount}
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
              <LoadingSpinner text="Chargement des comptes SIP…" />
            ) : accounts.length === 0 ? (
              <p className="admin-card__subtitle">Aucun compte SIP configuré.</p>
            ) : (
              <ResponsiveTable
                columns={columns}
                data={accounts}
                keyExtractor={(account) => account.id.toString()}
                mobileCardView={true}
              />
            )}

            <div className="admin-form__actions">
              <button className="button" onClick={handleCreateAccount}>
                + Ajouter un compte SIP
              </button>
            </div>
          </FormSection>
      </div>

      {showCreateModal && (
        <Modal
          title="Nouveau compte SIP"
          onClose={handleCancelAccount}
          footer={
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={handleCancelAccount}
              >
                Annuler
              </button>
              <button
                className="button"
                type="submit"
                form="create-sip-account-form"
                disabled={isSaving}
              >
                Créer le compte
              </button>
            </>
          }
        >
          <form id="create-sip-account-form" className="admin-form" onSubmit={handleFormSubmit(handleSubmitAccount)}>
            <div className="admin-form__row">
              <FormField
                label="Label"
                error={formErrors.label?.message}
                required
              >
                <input
                  className="input"
                  type="text"
                  {...register("label")}
                  placeholder="Trunk Principal"
                  disabled={isSaving}
                />
              </FormField>

              <FormField
                label="URI SIP"
                error={formErrors.trunk_uri?.message}
                hint="Format requis : sip:username@provider.com ou sips:username@provider.com"
                required
              >
                <input
                  className="input"
                  type="text"
                  {...register("trunk_uri")}
                  placeholder="sip:username@provider.com"
                  disabled={isSaving}
                />
              </FormField>
            </div>

            <div className="admin-form__row">
              <FormField label="Nom d'utilisateur">
                <input
                  className="input"
                  type="text"
                  {...register("username")}
                  disabled={isSaving}
                />
              </FormField>

              <FormField label="Mot de passe">
                <input
                  className="input"
                  type="password"
                  {...register("password")}
                  disabled={isSaving}
                />
              </FormField>
            </div>

            <div className="admin-form__divider" />

            <div className="admin-form__row">
              <FormField label="Hôte de contact">
                <input
                  className="input"
                  type="text"
                  {...register("contact_host")}
                  placeholder="votre-ip-publique.com"
                  disabled={isSaving}
                />
              </FormField>

              <FormField
                label="Port de contact"
                error={formErrors.contact_port?.message}
              >
                <input
                  className="input"
                  type="text"
                  {...register("contact_port")}
                  placeholder="5060"
                  disabled={isSaving}
                />
              </FormField>

              <FormField label="Transport">
                <select
                  className="input"
                  {...register("contact_transport")}
                  disabled={isSaving}
                >
                  <option value="udp">UDP</option>
                  <option value="tcp">TCP</option>
                  <option value="tls">TLS</option>
                </select>
              </FormField>
            </div>

            <div className="admin-form__divider" />

            <label className="checkbox-field">
              <input
                type="checkbox"
                {...register("is_default")}
                disabled={isSaving}
              />
              Compte par défaut
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                {...register("is_active")}
                disabled={isSaving}
              />
              Actif
            </label>
          </form>
        </Modal>
      )}
    </>
  );
};
