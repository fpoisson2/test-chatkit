import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { AdminTabs } from "../components/AdminTabs";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import { isUnauthorizedError } from "../utils/backend";

// ========== Types ==========

interface SipAccount {
  id: number;
  label: string;
  trunk_uri: string;
  username: string | null;
  password: string | null;
  contact_host: string | null;
  contact_port: number | null;
  contact_transport: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SipAccountForm {
  label: string;
  trunk_uri: string;
  username: string;
  password: string;
  contact_host: string;
  contact_port: string;
  contact_transport: string;
  is_default: boolean;
  is_active: boolean;
}

// ========== Helper Functions ==========

const emptySipAccountForm = (): SipAccountForm => ({
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

export const AdminTelephonyPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // SIP Accounts state
  const [accounts, setAccounts] = useState<SipAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [accountFormData, setAccountFormData] = useState<SipAccountForm>(emptySipAccountForm());
  const [isSavingAccount, setSavingAccount] = useState(false);

  // ========== SIP Accounts Functions ==========

  const loadAccounts = useCallback(async () => {
    if (!token) return;

    setAccountsLoading(true);
    setAccountError(null);

    try {
      const response = await fetch("/api/admin/sip-accounts", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response)) {
          logout();
          return;
        }
        throw new Error("Erreur lors du chargement des comptes SIP");
      }

      const data = await response.json();
      setAccounts(data);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setAccountsLoading(false);
    }
  }, [token, logout]);

  const handleCreateAccount = () => {
    setIsCreatingAccount(true);
    setEditingAccountId(null);
    setAccountFormData(emptySipAccountForm());
    setAccountError(null);
  };

  const handleEditAccount = (account: SipAccount) => {
    setIsCreatingAccount(false);
    setEditingAccountId(account.id);
    setAccountFormData({
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
    setAccountError(null);
  };

  const handleCancelAccount = () => {
    setIsCreatingAccount(false);
    setEditingAccountId(null);
    setAccountFormData(emptySipAccountForm());
    setAccountError(null);
  };

  const handleSubmitAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSavingAccount(true);
    setAccountError(null);

    try {
      const payload: any = {
        label: accountFormData.label,
        trunk_uri: accountFormData.trunk_uri,
        username: accountFormData.username || null,
        password: accountFormData.password || null,
        contact_host: accountFormData.contact_host || null,
        contact_port: accountFormData.contact_port ? parseInt(accountFormData.contact_port) : null,
        contact_transport: accountFormData.contact_transport,
        is_default: accountFormData.is_default,
        is_active: accountFormData.is_active,
      };

      const url = isCreatingAccount
        ? "/api/admin/sip-accounts"
        : `/api/admin/sip-accounts/${editingAccountId}`;
      const method = isCreatingAccount ? "POST" : "PATCH";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (isUnauthorizedError(response)) {
          logout();
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.detail || "Erreur lors de l'enregistrement");
      }

      handleCancelAccount();
      await loadAccounts();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingAccount(false);
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!token) return;
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce compte SIP ?")) return;

    setAccountError(null);

    try {
      const response = await fetch(`/api/admin/sip-accounts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response)) {
          logout();
          return;
        }
        throw new Error("Erreur lors de la suppression du compte SIP");
      }

      await loadAccounts();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  };

  // ========== Effects ==========

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // ========== Render ==========

  return (
    <>
      <AdminTabs activeTab="telephony" />
      <ManagementPageLayout>
        {accountError && <div className="alert alert--danger">{accountError}</div>}

        <div className="admin-grid">
          {/* ========== SIP Accounts Section ========== */}
          {(isCreatingAccount || editingAccountId) ? (
            <section className="admin-card">
              <div>
                <h2 className="admin-card__title">
                  {isCreatingAccount ? "Nouveau compte SIP" : "Modifier le compte SIP"}
                </h2>
                <p className="admin-card__subtitle">
                  Configurez les paramètres de connexion au trunk SIP.
                </p>
              </div>
              <form className="admin-form" onSubmit={handleSubmitAccount}>
                <div className="admin-form__row">
                  <label className="label">
                    Label *
                    <input
                      className="input"
                      type="text"
                      required
                      value={accountFormData.label}
                      onChange={(e) => setAccountFormData({ ...accountFormData, label: e.target.value })}
                      placeholder="Trunk Principal"
                      disabled={isSavingAccount}
                    />
                  </label>

                  <label className="label">
                    URI SIP *
                    <input
                      className="input"
                      type="text"
                      required
                      value={accountFormData.trunk_uri}
                      onChange={(e) => setAccountFormData({ ...accountFormData, trunk_uri: e.target.value })}
                      placeholder="sip:username@provider.com"
                      pattern="sips?:.+@.+"
                      title="Format: sip:username@provider.com ou sips:username@provider.com"
                      disabled={isSavingAccount}
                    />
                    <p className="admin-form__hint">
                      Format requis : <code>sip:username@provider.com</code> ou <code>sips:username@provider.com</code>
                    </p>
                  </label>
                </div>

                <div className="admin-form__row">
                  <label className="label">
                    Nom d'utilisateur
                    <input
                      className="input"
                      type="text"
                      value={accountFormData.username}
                      onChange={(e) => setAccountFormData({ ...accountFormData, username: e.target.value })}
                      disabled={isSavingAccount}
                    />
                  </label>

                  <label className="label">
                    Mot de passe
                    <input
                      className="input"
                      type="password"
                      value={accountFormData.password}
                      onChange={(e) => setAccountFormData({ ...accountFormData, password: e.target.value })}
                      placeholder={editingAccountId ? "(laisser vide pour ne pas changer)" : ""}
                      disabled={isSavingAccount}
                    />
                  </label>
                </div>

                <div className="admin-form__divider" />

                <div className="admin-form__row">
                  <label className="label">
                    Hôte de contact
                    <input
                      className="input"
                      type="text"
                      value={accountFormData.contact_host}
                      onChange={(e) => setAccountFormData({ ...accountFormData, contact_host: e.target.value })}
                      placeholder="votre-ip-publique.com"
                      disabled={isSavingAccount}
                    />
                  </label>

                  <label className="label">
                    Port de contact
                    <input
                      className="input"
                      type="number"
                      value={accountFormData.contact_port}
                      onChange={(e) => setAccountFormData({ ...accountFormData, contact_port: e.target.value })}
                      placeholder="5060"
                      min="1"
                      max="65535"
                      disabled={isSavingAccount}
                    />
                  </label>

                  <label className="label">
                    Transport
                    <select
                      className="input"
                      value={accountFormData.contact_transport}
                      onChange={(e) => setAccountFormData({ ...accountFormData, contact_transport: e.target.value })}
                      disabled={isSavingAccount}
                    >
                      <option value="udp">UDP</option>
                      <option value="tcp">TCP</option>
                      <option value="tls">TLS</option>
                    </select>
                  </label>
                </div>

                <div className="admin-form__divider" />

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={accountFormData.is_default}
                    onChange={(e) => setAccountFormData({ ...accountFormData, is_default: e.target.checked })}
                    disabled={isSavingAccount}
                  />
                  Compte par défaut
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={accountFormData.is_active}
                    onChange={(e) => setAccountFormData({ ...accountFormData, is_active: e.target.checked })}
                    disabled={isSavingAccount}
                  />
                  Actif
                </label>

                <div className="admin-form__actions">
                  <button className="button" type="submit" disabled={isSavingAccount}>
                    {isSavingAccount ? "Enregistrement..." : isCreatingAccount ? "Créer le compte" : "Enregistrer"}
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={handleCancelAccount}
                    disabled={isSavingAccount}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <section className="admin-card">
              <div>
                <h2 className="admin-card__title">Comptes SIP</h2>
                <p className="admin-card__subtitle">
                  Gérez les comptes SIP pour connecter ChatKit à vos trunks téléphoniques.
                  Chaque compte peut être associé à des workflows spécifiques.
                </p>
              </div>

              {accountsLoading ? (
                <p className="admin-card__subtitle">Chargement des comptes SIP…</p>
              ) : accounts.length === 0 ? (
                <p className="admin-card__subtitle">Aucun compte SIP configuré.</p>
              ) : (
                <div className="admin-table-wrapper">
                  <table className="admin-table admin-table--stack">
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>URI</th>
                        <th>Utilisateur</th>
                        <th>Transport</th>
                        <th>Statut</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((account) => (
                        <tr key={account.id}>
                          <td>
                            <strong>{account.label}</strong>
                            {account.is_default && (
                              <span className="badge badge--primary" style={{ marginLeft: "8px" }}>
                                Défaut
                              </span>
                            )}
                          </td>
                          <td><code>{account.trunk_uri}</code></td>
                          <td>{account.username || "—"}</td>
                          <td>{account.contact_transport?.toUpperCase() || "UDP"}</td>
                          <td>
                            <span className={`badge ${account.is_active ? "badge--success" : "badge--secondary"}`}>
                              {account.is_active ? "Actif" : "Inactif"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="button button--small button--secondary"
                              onClick={() => handleEditAccount(account)}
                            >
                              Modifier
                            </button>
                            {" "}
                            <button
                              className="button button--small button--danger"
                              onClick={() => handleDeleteAccount(account.id)}
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
              <div className="admin-form__actions">
                <button className="button" onClick={handleCreateAccount}>
                  + Ajouter un compte SIP
                </button>
              </div>
            </section>
          )}
        </div>
      </ManagementPageLayout>
    </>
  );
};
