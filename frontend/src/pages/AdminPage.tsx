import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  CreateUserPayload,
  EditableUser,
  adminApi,
  isUnauthorizedError,
  resetUserPassword,
} from "../utils/backend";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { ResponsiveTable, type Column } from "../components";

export const AdminPage = () => {
  const { token, logout } = useAuth();
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createPayload, setCreatePayload] = useState<CreateUserPayload>({
    email: "",
    password: "",
    is_admin: false,
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

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createPayload.email || !createPayload.password) {
      return;
    }

    try {
      const created = await adminApi.createUser(token, createPayload);
      setUsers((prev) => [...prev, created]);
      setCreatePayload({ email: "", password: "", is_admin: false });
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
      <AdminTabs activeTab="users" />
      <ManagementPageLayout>
        {error && <div className="alert alert--danger">{error}</div>}

        <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Créer un utilisateur</h2>
              <p className="admin-card__subtitle">
                Invitez un collaborateur et attribuez-lui un rôle adapté à son
                usage de ChatKit.
              </p>
            </div>
            <form className="admin-form" onSubmit={handleCreate}>
              <div className="admin-form__row">
                <label className="label">
                  E-mail
                  <input
                    className="input"
                    type="email"
                    required
                    value={createPayload.email}
                    onChange={(event) =>
                      setCreatePayload((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    placeholder="nouvel.utilisateur@example.com"
                  />
                </label>
                <label className="label">
                  Mot de passe temporaire
                  <input
                    className="input"
                    type="text"
                    required
                    value={createPayload.password}
                    onChange={(event) =>
                      setCreatePayload((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    placeholder="Mot de passe temporaire"
                  />
                </label>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={createPayload.is_admin}
                  onChange={(event) =>
                    setCreatePayload((prev) => ({
                      ...prev,
                      is_admin: event.target.checked,
                    }))
                  }
                />
                Administrateur
              </label>
              <div className="admin-form__actions">
                <button className="button" type="submit">
                  Ajouter
                </button>
              </div>
            </form>
          </section>

          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Utilisateurs</h2>
              <p className="admin-card__subtitle">
                Consultez les accès existants et appliquez des actions rapides
                pour chaque compte.
              </p>
            </div>
            {isLoading ? (
              <p className="admin-card__subtitle">
                Chargement des utilisateurs…
              </p>
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
          </section>
        </div>
      </ManagementPageLayout>
    </>
  );
};
