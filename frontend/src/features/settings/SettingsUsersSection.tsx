import type { FormEvent } from "react";

import type { AuthUser } from "../../auth";
import type {
  AdminUsersActions,
  AdminUsersState,
  EditableUser,
} from "./useAdminUsers";
import type { SettingsSection } from "./sections";

export type SettingsUsersSectionProps = {
  activeSection: SettingsSection;
  currentUser: AuthUser | null;
  onGoHome: () => void;
  onLogout: () => void;
  onOpenWorkflows: () => void;
  state: AdminUsersState;
  actions: AdminUsersActions;
};

export function SettingsUsersSection({
  activeSection,
  currentUser,
  onGoHome,
  onLogout,
  onOpenWorkflows,
  state,
  actions,
}: SettingsUsersSectionProps) {
  const { users, isLoading, error, createPayload, isCreatingUser } = state;
  const { setCreatePayload, refresh, createUser, toggleAdmin, deleteUser, updatePassword } = actions;

  if (!currentUser?.is_admin) {
    return (
      <section
        key="users"
        className="settings-modal__section"
        aria-labelledby="settings-section-users-title"
        id="settings-section-users"
      >
        <header className="settings-modal__section-header">
          <h3 id="settings-section-users-title" className="settings-modal__section-title">
            {activeSection.label}
          </h3>
          <p className="settings-modal__section-description">{activeSection.description}</p>
        </header>
        <div className="settings-modal__section-body">
          <div className="settings-modal__card settings-modal__card--muted">
            <h4 className="settings-modal__card-title">Administration</h4>
            <p className="settings-modal__card-description">
              Vous n'avez pas les droits nécessaires pour consulter la gestion des utilisateurs. Contactez un
              administrateur pour obtenir un accès étendu.
            </p>
          </div>
          <div className="settings-modal__card">
            <h4 className="settings-modal__card-title">Actions rapides</h4>
            <p className="settings-modal__card-description">
              Retournez à l'accueil ou fermez votre session en toute sécurité.
            </p>
            <div className="settings-modal__actions">
              <button type="button" className="settings-modal__action-button" onClick={onGoHome}>
                Retour à l'accueil
              </button>
              <button
                type="button"
                className="settings-modal__action-button settings-modal__action-button--danger"
                onClick={onLogout}
              >
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const userCountLabel = users.length ? ` · ${users.length} utilisateur${users.length > 1 ? "s" : ""}` : "";

  const handleCreateUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createUser();
  };

  const handleToggleAdmin = (editableUser: EditableUser) => {
    void toggleAdmin(editableUser);
  };

  const handleDeleteUser = (editableUser: EditableUser) => {
    if (window.confirm(`Supprimer ${editableUser.email} ?`)) {
      void deleteUser(editableUser);
    }
  };

  const handleResetPassword = (editableUser: EditableUser) => {
    const newPassword = window.prompt(`Nouveau mot de passe pour ${editableUser.email}`);
    if (newPassword) {
      void updatePassword(editableUser, newPassword);
    }
  };

  return (
    <section
      key="users"
      className="settings-modal__section"
      aria-labelledby="settings-section-users-title"
      id="settings-section-users"
    >
      <header className="settings-modal__section-header">
        <h3 id="settings-section-users-title" className="settings-modal__section-title">
          {activeSection.label}
        </h3>
        <p className="settings-modal__section-description">{activeSection.description}</p>
      </header>
      <div className="settings-modal__section-body">
        <div className="settings-users">
          <div className="settings-users__intro">
            <div>
              <h4 className="admin-shell__title">Administration des utilisateurs</h4>
              <p className="admin-shell__subtitle">
                Gérez les accès autorisés au widget ChatKit et pilotez les rôles en un clin d'œil.
              </p>
            </div>
            <div className="settings-users__meta">
              <span className="admin-shell__chips">
                {currentUser?.email ?? "Administrateur"}
                {userCountLabel}
              </span>
              <button className="button button--ghost" type="button" onClick={onLogout}>
                Déconnexion
              </button>
            </div>
          </div>

          {error && <div className="alert alert--danger">{error}</div>}

          <div className="settings-users__toolbar">
            <button className="button button--ghost" type="button" onClick={onOpenWorkflows}>
              Configurer le workflow ChatKit
            </button>
            <button
              className="button button--subtle"
              type="button"
              onClick={() => {
                void refresh();
              }}
              disabled={isLoading}
            >
              {isLoading ? "Actualisation…" : "Actualiser la liste"}
            </button>
          </div>

          <div className="settings-users__grid">
            <section className="admin-card">
              <div>
                <h5 className="admin-card__title">Créer un utilisateur</h5>
                <p className="admin-card__subtitle">
                  Invitez un collaborateur et attribuez-lui un rôle adapté à son usage de ChatKit.
                </p>
              </div>
              <form className="admin-form" onSubmit={handleCreateUser}>
                <div className="admin-form__row">
                  <label className="label">
                    E-mail
                    <input
                      className="input"
                      type="email"
                      required
                      value={createPayload.email}
                      onChange={(event) =>
                        setCreatePayload((prev) => ({ ...prev, email: event.target.value }))
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
                        setCreatePayload((prev) => ({ ...prev, password: event.target.value }))
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
                      setCreatePayload((prev) => ({ ...prev, is_admin: event.target.checked }))
                    }
                  />
                  Administrateur
                </label>
                <div className="admin-form__actions">
                  <button className="button" type="submit" disabled={isCreatingUser}>
                    {isCreatingUser ? "Ajout en cours…" : "Ajouter"}
                  </button>
                </div>
              </form>
            </section>

            <section className="admin-card">
              <div>
                <h5 className="admin-card__title">Utilisateurs</h5>
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
                                onClick={() => {
                                  handleToggleAdmin(editableUser);
                                }}
                              >
                                {editableUser.is_admin ? "Retirer admin" : "Promouvoir"}
                              </button>
                              <button
                                className="button button--ghost button--sm"
                                type="button"
                                onClick={() => {
                                  handleResetPassword(editableUser);
                                }}
                              >
                                Réinitialiser
                              </button>
                              <button
                                className="button button--danger button--sm"
                                type="button"
                                onClick={() => {
                                  handleDeleteUser(editableUser);
                                }}
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
    </section>
  );
}
