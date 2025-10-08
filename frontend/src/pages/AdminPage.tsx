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
  }, [headers, token]);

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

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc" }}>
      <header
        style={{
          padding: "16px 24px",
          backgroundColor: "white",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.75rem", color: "#0f172a" }}>Administration des utilisateurs</h1>
          <p style={{ margin: "4px 0 0", color: "#475569" }}>
            Gérez les comptes autorisés à accéder au widget ChatKit.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ color: "#475569" }}>{currentUser?.email}</span>
          <button
            type="button"
            onClick={logout}
            style={{
              backgroundColor: "#0f172a",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 14px",
              cursor: "pointer",
            }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "24px" }}>
        {error && (
          <div style={{ color: "#b91c1c", backgroundColor: "#fee2e2", padding: "12px", borderRadius: "8px" }}>
            {error}
          </div>
        )}

        <section
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "24px",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)",
          }}
        >
          <h2 style={{ marginTop: 0, color: "#0f172a" }}>Créer un utilisateur</h2>
          <form onSubmit={handleCreate} style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "6px" }}>
              E-mail
              <input
                type="email"
                required
                value={createPayload.email}
                onChange={(event) => setCreatePayload((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="nouvel.utilisateur@example.com"
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5f5",
                }}
              />
            </label>
            <label style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "6px" }}>
              Mot de passe
              <input
                type="text"
                required
                value={createPayload.password}
                onChange={(event) => setCreatePayload((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Mot de passe temporaire"
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5f5",
                }}
              />
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                paddingTop: "24px",
              }}
            >
              <input
                type="checkbox"
                checked={createPayload.is_admin}
                onChange={(event) =>
                  setCreatePayload((prev) => ({ ...prev, is_admin: event.target.checked }))
                }
              />
              Administrateur
            </label>
            <button
              type="submit"
              style={{
                backgroundColor: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "12px 20px",
                cursor: "pointer",
                alignSelf: "flex-end",
              }}
            >
              Ajouter
            </button>
          </form>
        </section>

        <section
          style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "24px",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.05)",
          }}
        >
          <h2 style={{ marginTop: 0, color: "#0f172a" }}>Utilisateurs</h2>
          {isLoading ? (
            <p>Chargement des utilisateurs…</p>
          ) : users.length === 0 ? (
            <p>Aucun utilisateur pour le moment.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "12px" }}>E-mail</th>
                    <th style={{ padding: "12px" }}>Rôle</th>
                    <th style={{ padding: "12px" }}>Créé le</th>
                    <th style={{ padding: "12px" }}>Mis à jour le</th>
                    <th style={{ padding: "12px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((editableUser) => (
                    <tr key={editableUser.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "12px" }}>{editableUser.email}</td>
                      <td style={{ padding: "12px" }}>
                        {editableUser.is_admin ? "Administrateur" : "Utilisateur"}
                      </td>
                      <td style={{ padding: "12px" }}>
                        {new Date(editableUser.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: "12px" }}>
                        {new Date(editableUser.updated_at).toLocaleString()}
                      </td>
                      <td style={{ padding: "12px", display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => handleToggleAdmin(editableUser)}
                          style={{
                            backgroundColor: "#1d4ed8",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            cursor: "pointer",
                          }}
                        >
                          {editableUser.is_admin ? "Retirer admin" : "Promouvoir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetPassword(editableUser)}
                          style={{
                            backgroundColor: "#0f172a",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            cursor: "pointer",
                          }}
                        >
                          Réinitialiser le mot de passe
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(editableUser)}
                          style={{
                            backgroundColor: "#dc2626",
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            cursor: "pointer",
                          }}
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
