import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "../auth";
import {
  EditableUser,
  adminApi,
  isUnauthorizedError,
  resetUserPassword,
} from "../utils/backend";
import { Modal } from "../components/Modal";
import {
  ResponsiveTable,
  type Column,
  LoadingSpinner,
  FeedbackMessages,
  FormField,
  FormSection,
} from "../components";
import { adminCreateUserSchema, type AdminCreateUserFormData } from "../schemas/admin";

export const AdminPage = () => {
  const { token, logout } = useAuth();
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors: formErrors },
    reset,
  } = useForm<AdminCreateUserFormData>({
    resolver: zodResolver(adminCreateUserSchema),
    defaultValues: {
      email: "",
      password: "",
      is_admin: false,
    },
  });

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
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue",
      );
    } finally {
      setLoading(false);
    }
  }, [logout, token]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (data: AdminCreateUserFormData) => {
    try {
      const created = await adminApi.createUser(token, data);
      setUsers((prev) => [...prev, created]);
      reset();
      setShowCreateModal(false);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue",
      );
    }
  };

  const handleToggleAdmin = async (editableUser: EditableUser) => {
    try {
      const updated = await adminApi.updateUser(token, editableUser.id, {
        is_admin: !editableUser.is_admin,
      });
      setUsers((prev) =>
        prev.map((user) => (user.id === updated.id ? updated : user)),
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue",
      );
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
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue",
      );
    }
  };

  const handleResetPassword = async (editableUser: EditableUser) => {
    const newPassword = window.prompt(
      `Nouveau mot de passe pour ${editableUser.email}`,
    );
    if (!newPassword) {
      return;
    }

    try {
      const updated = await resetUserPassword(token, editableUser.id, {
        password: newPassword,
      });
      setUsers((prev) =>
        prev.map((user) => (user.id === updated.id ? updated : user)),
      );
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur inattendue est survenue",
      );
    }
  };

  const userColumns = useMemo<Column<EditableUser>[]>(
    () => [
      {
        key: "email",
        label: "E-mail",
        render: (user) => user.email,
      },
      {
        key: "role",
        label: "Rôle",
        render: (user) => (user.is_admin ? "Administrateur" : "Utilisateur"),
      },
      {
        key: "created",
        label: "Créé le",
        render: (user) => new Date(user.created_at).toLocaleString(),
      },
      {
        key: "updated",
        label: "Mis à jour le",
        render: (user) => new Date(user.updated_at).toLocaleString(),
      },
      {
        key: "actions",
        label: "Actions",
        render: (user) => (
          <div className="admin-table__actions">
            <button
              className="button button--subtle button--sm"
              type="button"
              onClick={() => handleToggleAdmin(user)}
            >
              {user.is_admin ? "Retirer admin" : "Promouvoir"}
            </button>
            <button
              className="button button--ghost button--sm"
              type="button"
              onClick={() => handleResetPassword(user)}
            >
              Réinitialiser le mot de passe
            </button>
            <button
              className="button button--danger button--sm"
              type="button"
              onClick={() => handleDelete(user)}
            >
              Supprimer
            </button>
          </div>
        ),
      },
    ],
    [handleToggleAdmin, handleResetPassword, handleDelete],
  );

  return (
    <>
      <FeedbackMessages
        error={error}
        onDismissError={() => setError(null)}
      />

      <div className="admin-grid">
        <FormSection
          title="Utilisateurs"
          subtitle="Consultez les accès existants et appliquez des actions rapides pour chaque compte."
          headerAction={
            <button
              type="button"
              className="management-header__icon-button"
              aria-label="Créer un utilisateur"
              title="Créer un utilisateur"
              onClick={() => setShowCreateModal(true)}
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
            <LoadingSpinner text="Chargement des utilisateurs…" />
          ) : users.length === 0 ? (
            <p className="admin-card__subtitle">
              Aucun utilisateur pour le moment.
            </p>
          ) : (
            <ResponsiveTable
              columns={userColumns}
              data={users}
              keyExtractor={(user) => user.id}
              mobileCardView={true}
            />
          )}
        </FormSection>
      </div>

      {showCreateModal && (
        <Modal
          title="Créer un utilisateur"
          onClose={() => setShowCreateModal(false)}
          footer={
            <>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setShowCreateModal(false)}
              >
                Annuler
              </button>
              <button
                className="button"
                type="submit"
                form="create-user-form"
              >
                Ajouter
              </button>
            </>
          }
        >
          <form id="create-user-form" className="admin-form" onSubmit={handleSubmit(handleCreate)}>
            <div className="admin-form__row">
              <FormField
                label="E-mail"
                error={formErrors.email?.message}
              >
                <input
                  className="input"
                  type="email"
                  {...register("email")}
                  placeholder="nouvel.utilisateur@example.com"
                />
              </FormField>

              <FormField
                label="Mot de passe temporaire"
                error={formErrors.password?.message}
              >
                <input
                  className="input"
                  type="text"
                  {...register("password")}
                  placeholder="Mot de passe temporaire"
                />
              </FormField>
            </div>

            <label className="checkbox-field">
              <input type="checkbox" {...register("is_admin")} />
              Administrateur
            </label>
          </form>
        </Modal>
      )}
    </>
  );
};
