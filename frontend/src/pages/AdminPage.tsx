import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AuthUser, useAuth } from "../auth";

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "";

type EditableUser = AuthUser;

type CreateUserPayload = {
  email: string;
  password: string;
  is_admin: boolean;
};

export const AdminPage = () => {
  const { token, user: currentUser, logout } = useAuth();
  const [users, setUsers] = useState<EditableUser[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createPayload, setCreatePayload] = useState<CreateUserPayload>({
    email: "",
    password: "",
    is_admin: false,
  });

  const headers = useMemo(() => {
    const base: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      base.Authorization = `Bearer ${token}`;
    }
    return base;
  }, [token]);

  const fetchUsers = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${backendUrl}/api/admin/users`, {
        headers,
      });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de récupérer les utilisateurs");
      }
      const data: EditableUser[] = await response.json();
      setUsers(data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    } finally {
      setLoading(false);
    }
  }, [headers, logout, token]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createPayload.email || !createPayload.password) {
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/admin/users`, {
        method: "POST",
        headers,
        body: JSON.stringify(createPayload),
      });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de créer l'utilisateur");
      }
      const created: EditableUser = await response.json();
      setUsers((prev) => [...prev, created]);
      setCreatePayload({ email: "", password: "", is_admin: false });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    }
  };

  const handleToggleAdmin = async (editableUser: EditableUser) => {
    try {
      const response = await fetch(`${backendUrl}/api/admin/users/${editableUser.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_admin: !editableUser.is_admin }),
      });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de mettre à jour l'utilisateur");
      }
      const updated: EditableUser = await response.json();
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    }
  };

  const handleDelete = async (editableUser: EditableUser) => {
    if (!window.confirm(`Supprimer ${editableUser.email} ?`)) {
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/admin/users/${editableUser.id}`, {
        method: "DELETE",
        headers,
      });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok && response.status !== 204) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de supprimer l'utilisateur");
      }
      setUsers((prev) => prev.filter((user) => user.id !== editableUser.id));
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    }
  };

  const handleResetPassword = async (editableUser: EditableUser) => {
    const newPassword = window.prompt(`Nouveau mot de passe pour ${editableUser.email}`);
    if (!newPassword) {
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/api/admin/users/${editableUser.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ password: newPassword }),
      });
      if (response.status === 401) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (!response.ok) {
        const { detail } = await response.json();
        throw new Error(detail ?? "Impossible de mettre à jour le mot de passe");
      }
      const updated: EditableUser = await response.json();
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur inattendue est survenue");
      }
    }
  };

  const userCountLabel = users.length
    ? ` · ${users.length} utilisateur${users.length > 1 ? "s" : ""}`
    : "";

  return (
    <div className="admin-layout">
      <div className="admin-shell">
        <header className="admin-shell__header">
          <div>
            <h1 className="admin-shell__title">Administration des utilisateurs</h1>
            <p className="admin-shell__subtitle">
              Gérez les accès autorisés au widget ChatKit et pilotez les rôles en un clin d'œil.
            </p>
          </div>
          <div className="admin-shell__toolbar">
            <span className="admin-shell__chips">
              {currentUser?.email ?? "Administrateur"}
              {userCountLabel}
            </span>
            <button className="button button--ghost" type="button" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </header>

        {error && <div className="alert alert--danger">{error}</div>}

        <div className="admin-grid">
          <section className="admin-card">
            <div>
              <h2 className="admin-card__title">Créer un utilisateur</h2>
              <p className="admin-card__subtitle">
                Invitez un collaborateur et attribuez-lui un rôle adapté à son usage de ChatKit.
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
                    onChange={(event) => setCreatePayload((prev) => ({ ...prev, email: event.target.value }))}
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
                    onChange={(event) => setCreatePayload((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="Mot de passe temporaire"
                  />
                </label>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={createPayload.is_admin}
                  onChange={(event) =>
                    setCreatePayload((prev) => ({ ...prev, is_admin: event.target.checked }))
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
                Consultez les accès existants et appliquez des actions rapides pour chaque compte.
              </p>
            </div>
            {isLoading ? (
              <p className="admin-card__subtitle">Chargement des utilisateurs…</p>
            ) : users.length === 0 ? (
              <p className="admin-card__subtitle">Aucun utilisateur pour le moment.</p>
            ) : (
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>E-mail</th>
                      <th>Rôle</th>
                      <th>Créé le</th>
                      <th>Mis à jour le</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((editableUser) => (
                      <tr key={editableUser.id}>
                        <td>{editableUser.email}</td>
                        <td>{editableUser.is_admin ? "Administrateur" : "Utilisateur"}</td>
                        <td>{new Date(editableUser.created_at).toLocaleString()}</td>
                        <td>{new Date(editableUser.updated_at).toLocaleString()}</td>
                        <td>
                          <div className="admin-table__actions">
                            <button
                              className="button button--subtle button--sm"
                              type="button"
                              onClick={() => handleToggleAdmin(editableUser)}
                            >
                              {editableUser.is_admin ? "Retirer admin" : "Promouvoir"}
                            </button>
                            <button
                              className="button button--ghost button--sm"
                              type="button"
                              onClick={() => handleResetPassword(editableUser)}
                            >
                              Réinitialiser
                            </button>
                            <button
                              className="button button--danger button--sm"
                              type="button"
                              onClick={() => handleDelete(editableUser)}
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
      </div>
    </div>
  );
};
