import type { FormEvent } from "react";

import type { AuthUser } from "../../auth";
import type {
  AdminUsersActions,
  AdminUsersState,
  EditableUser,
} from "./useAdminUsers";
import type { SettingsSection } from "./sections";
import { useI18n } from "../../i18n";

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
  const { t } = useI18n();
  const { users, isLoading, error, createPayload, isCreatingUser } = state;
  const { setCreatePayload, refresh, createUser, toggleAdmin, deleteUser, updatePassword } = actions;

  if (!currentUser?.is_admin) {
    return (
      <section
        key="users"
        className="settings-page__section"
        aria-labelledby="settings-section-users-title"
        id="settings-section-users"
      >
        <header className="settings-page__section-header">
          <h3 id="settings-section-users-title" className="settings-page__section-title">
            {activeSection.label}
          </h3>
          <p className="settings-page__section-description">{activeSection.description}</p>
        </header>
        <div className="settings-page__section-body">
          <div className="settings-page__card settings-page__card--muted">
            <h4 className="settings-page__card-title">{t("settings.users.accessRestricted.title")}</h4>
            <p className="settings-page__card-description">
              {t("settings.users.accessRestricted.description")}
            </p>
          </div>
          <div className="settings-page__card">
            <h4 className="settings-page__card-title">{t("settings.users.accessRestricted.actionsTitle")}</h4>
            <p className="settings-page__card-description">
              {t("settings.users.accessRestricted.actionsDescription")}
            </p>
            <div className="settings-page__actions">
              <button type="button" className="settings-page__action-button" onClick={onGoHome}>
                {t("settings.users.actions.goHome")}
              </button>
              <button
                type="button"
                className="settings-page__action-button settings-page__action-button--danger"
                onClick={onLogout}
              >
                {t("settings.users.actions.logout")}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const userCountLabel = users.length
    ? ` · ${t(
        users.length > 1
          ? "settings.users.meta.countPlural"
          : "settings.users.meta.countSingular",
        { count: users.length },
      )}`
    : "";

  const handleCreateUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createUser();
  };

  const handleToggleAdmin = (editableUser: EditableUser) => {
    void toggleAdmin(editableUser);
  };

  const handleDeleteUser = (editableUser: EditableUser) => {
    if (window.confirm(t("settings.users.actions.delete.confirm", { email: editableUser.email }))) {
      void deleteUser(editableUser);
    }
  };

  const handleResetPassword = (editableUser: EditableUser) => {
    const newPassword = window.prompt(
      t("settings.users.actions.resetPassword.prompt", { email: editableUser.email }),
    );
    if (newPassword) {
      void updatePassword(editableUser, newPassword);
    }
  };

  return (
    <section
      key="users"
      className="settings-page__section"
      aria-labelledby="settings-section-users-title"
      id="settings-section-users"
    >
      <header className="settings-page__section-header">
        <h3 id="settings-section-users-title" className="settings-page__section-title">
          {activeSection.label}
        </h3>
        <p className="settings-page__section-description">{activeSection.description}</p>
      </header>
      <div className="settings-page__section-body">
        <div className="settings-users">
          <div className="settings-users__intro">
            <div>
              <h4 className="admin-shell__title">{t("settings.users.admin.title")}</h4>
              <p className="admin-shell__subtitle">{t("settings.users.admin.subtitle")}</p>
            </div>
            <div className="settings-users__meta">
              <span className="admin-shell__chips">
                {currentUser?.email ?? t("settings.users.meta.fallbackAdmin")}
                {userCountLabel}
              </span>
              <button className="button button--ghost" type="button" onClick={onLogout}>
                {t("settings.users.actions.logout")}
              </button>
            </div>
          </div>

          {error && <div className="alert alert--danger">{error}</div>}

          <div className="settings-users__toolbar">
            <button className="button button--ghost" type="button" onClick={onOpenWorkflows}>
              {t("settings.users.actions.configureWorkflow")}
            </button>
            <button
              className="button button--subtle"
              type="button"
              onClick={() => {
                void refresh();
              }}
              disabled={isLoading}
            >
              {isLoading
                ? t("settings.users.actions.refreshing")
                : t("settings.users.actions.refresh")}
            </button>
          </div>

          <div className="settings-users__grid">
            <section className="admin-card">
              <div>
                <h5 className="admin-card__title">{t("settings.users.create.title")}</h5>
                <p className="admin-card__subtitle">{t("settings.users.create.subtitle")}</p>
              </div>
              <form className="admin-form" onSubmit={handleCreateUser}>
                <div className="admin-form__row">
                  <label className="label">
                    {t("settings.users.create.email")}
                    <input
                      className="input"
                      type="email"
                      required
                      value={createPayload.email}
                      onChange={(event) =>
                        setCreatePayload((prev) => ({ ...prev, email: event.target.value }))
                      }
                      placeholder={t("settings.users.create.emailPlaceholder")}
                    />
                  </label>
                  <label className="label">
                    {t("settings.users.create.tempPassword")}
                    <input
                      className="input"
                      type="text"
                      required
                      value={createPayload.password}
                      onChange={(event) =>
                        setCreatePayload((prev) => ({ ...prev, password: event.target.value }))
                      }
                      placeholder={t("settings.users.create.tempPasswordPlaceholder")}
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
                  {t("settings.users.create.adminToggle")}
                </label>
                <div className="admin-form__actions">
                  <button className="button" type="submit" disabled={isCreatingUser}>
                    {isCreatingUser
                      ? t("settings.users.create.submit.loading")
                      : t("settings.users.create.submit.label")}
                  </button>
                </div>
              </form>
            </section>

            <section className="admin-card">
              <div>
                <h5 className="admin-card__title">{t("settings.users.table.title")}</h5>
                <p className="admin-card__subtitle">{t("settings.users.table.subtitle")}</p>
              </div>
              {isLoading ? (
                <p className="admin-card__subtitle">{t("settings.users.table.loading")}</p>
              ) : users.length === 0 ? (
                <p className="admin-card__subtitle">{t("settings.users.table.empty")}</p>
              ) : (
                <div className="admin-table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("settings.users.table.header.email")}</th>
                        <th>{t("settings.users.table.header.role")}</th>
                        <th>{t("settings.users.table.header.createdAt")}</th>
                        <th>{t("settings.users.table.header.updatedAt")}</th>
                        <th>{t("settings.users.table.header.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((editableUser) => (
                        <tr key={editableUser.id}>
                          <td>{editableUser.email}</td>
                          <td>
                            {editableUser.is_admin
                              ? t("settings.users.roles.admin")
                              : t("settings.users.roles.user")}
                          </td>
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
                                {editableUser.is_admin
                                  ? t("settings.users.actions.demote")
                                  : t("settings.users.actions.promote")}
                              </button>
                              <button
                                className="button button--ghost button--sm"
                                type="button"
                                onClick={() => {
                                  handleResetPassword(editableUser);
                                }}
                              >
                                {t("settings.users.actions.resetPassword")}
                              </button>
                              <button
                                className="button button--danger button--sm"
                                type="button"
                                onClick={() => {
                                  handleDeleteUser(editableUser);
                                }}
                              >
                                {t("settings.users.actions.delete")}
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
