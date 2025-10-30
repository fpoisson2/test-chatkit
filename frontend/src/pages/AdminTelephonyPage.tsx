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

interface TelephonyRoute {
  id: number;
  phone_number: string;
  workflow_slug: string | null;
  workflow_id: number | null;
  metadata_: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface TelephonyRouteForm {
  phone_number: string;
  workflow_slug: string;
  workflow_id: string;
}

type TelephonyTab = "accounts" | "routes" | "settings";

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

const emptyTelephonyRouteForm = (): TelephonyRouteForm => ({
  phone_number: "",
  workflow_slug: "",
  workflow_id: "",
});

// ========== Main Component ==========

export const AdminTelephonyPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();

  // Tab state
  const [activeTab, setActiveTab] = useState<TelephonyTab>("accounts");

  // SIP Accounts state
  const [accounts, setAccounts] = useState<SipAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [accountFormData, setAccountFormData] = useState<SipAccountForm>(emptySipAccountForm());
  const [isSavingAccount, setSavingAccount] = useState(false);

  // Telephony Routes state
  const [routes, setRoutes] = useState<TelephonyRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeSuccess, setRouteSuccess] = useState<string | null>(null);
  const [isCreatingRoute, setIsCreatingRoute] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [routeFormData, setRouteFormData] = useState<TelephonyRouteForm>(emptyTelephonyRouteForm());
  const [isSavingRoute, setSavingRoute] = useState(false);

  // ========== SIP Accounts Functions ==========

  const loadAccounts = useCallback(async () => {
    if (!token) return;

    setAccountsLoading(true);
    setAccountError(null);

    try {
      const response = await fetch("/api/admin/sip-accounts", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
    setAccountSuccess(null);
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
    setAccountSuccess(null);
  };

  const handleCancelAccount = () => {
    setIsCreatingAccount(false);
    setEditingAccountId(null);
    setAccountFormData(emptySipAccountForm());
    setAccountError(null);
    setAccountSuccess(null);
  };

  const handleSubmitAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSavingAccount(true);
    setAccountError(null);
    setAccountSuccess(null);

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

      setAccountSuccess(isCreatingAccount ? "Compte SIP créé avec succès" : "Compte SIP mis à jour avec succès");
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
    setAccountSuccess(null);

    try {
      const response = await fetch(`/api/admin/sip-accounts/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response)) {
          logout();
          return;
        }
        throw new Error("Erreur lors de la suppression du compte SIP");
      }

      setAccountSuccess("Compte SIP supprimé avec succès");
      await loadAccounts();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  };

  // ========== Telephony Routes Functions ==========

  const loadRoutes = useCallback(async () => {
    if (!token) return;

    setRoutesLoading(true);
    setRouteError(null);

    try {
      const response = await fetch("/api/admin/telephony-routes", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response)) {
          logout();
          return;
        }
        throw new Error("Erreur lors du chargement des routes");
      }

      const data = await response.json();
      setRoutes(data);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setRoutesLoading(false);
    }
  }, [token, logout]);

  const handleCreateRoute = () => {
    setIsCreatingRoute(true);
    setEditingRouteId(null);
    setRouteFormData(emptyTelephonyRouteForm());
    setRouteError(null);
    setRouteSuccess(null);
  };

  const handleEditRoute = (route: TelephonyRoute) => {
    setIsCreatingRoute(false);
    setEditingRouteId(route.id);
    setRouteFormData({
      phone_number: route.phone_number,
      workflow_slug: route.workflow_slug || "",
      workflow_id: route.workflow_id?.toString() || "",
    });
    setRouteError(null);
    setRouteSuccess(null);
  };

  const handleCancelRoute = () => {
    setIsCreatingRoute(false);
    setEditingRouteId(null);
    setRouteFormData(emptyTelephonyRouteForm());
    setRouteError(null);
    setRouteSuccess(null);
  };

  const handleSubmitRoute = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSavingRoute(true);
    setRouteError(null);
    setRouteSuccess(null);

    try {
      const payload: any = {
        phone_number: routeFormData.phone_number,
        workflow_slug: routeFormData.workflow_slug || null,
        workflow_id: routeFormData.workflow_id ? parseInt(routeFormData.workflow_id) : null,
        metadata: {},
      };

      const url = isCreatingRoute
        ? "/api/admin/telephony-routes"
        : `/api/admin/telephony-routes/${editingRouteId}`;
      const method = isCreatingRoute ? "POST" : "PATCH";

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

      setRouteSuccess(isCreatingRoute ? "Route créée avec succès" : "Route mise à jour avec succès");
      handleCancelRoute();
      await loadRoutes();
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingRoute(false);
    }
  };

  const handleDeleteRoute = async (id: number) => {
    if (!token) return;
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette route ?")) return;

    setRouteError(null);
    setRouteSuccess(null);

    try {
      const response = await fetch(`/api/admin/telephony-routes/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (isUnauthorizedError(response)) {
          logout();
          return;
        }
        throw new Error("Erreur lors de la suppression de la route");
      }

      setRouteSuccess("Route supprimée avec succès");
      await loadRoutes();
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  };

  // ========== Effects ==========

  useEffect(() => {
    if (activeTab === "accounts") {
      loadAccounts();
    } else if (activeTab === "routes") {
      loadRoutes();
    }
  }, [activeTab, loadAccounts, loadRoutes]);

  // ========== Render ==========

  return (
    <ManagementPageLayout>
      <AdminTabs />
      <div className="px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            Téléphonie
          </h1>

          {/* Sub-tabs */}
          <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab("accounts")}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === "accounts"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                Comptes SIP
              </button>
              <button
                onClick={() => setActiveTab("routes")}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === "routes"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                Routes
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === "settings"
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                Paramètres globaux
              </button>
            </nav>
          </div>

          {/* SIP Accounts Tab */}
          {activeTab === "accounts" && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Gestion des comptes SIP
                </h2>
                {!isCreatingAccount && !editingAccountId && (
                  <button
                    onClick={handleCreateAccount}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    + Ajouter un compte
                  </button>
                )}
              </div>

              {accountError && (
                <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg">
                  {accountError}
                </div>
              )}

              {accountSuccess && (
                <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-lg">
                  {accountSuccess}
                </div>
              )}

              {(isCreatingAccount || editingAccountId) && (
                <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                    {isCreatingAccount ? "Nouveau compte SIP" : "Modifier le compte SIP"}
                  </h3>
                  <form onSubmit={handleSubmitAccount} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Label *
                        </label>
                        <input
                          type="text"
                          required
                          value={accountFormData.label}
                          onChange={(e) => setAccountFormData({ ...accountFormData, label: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="Trunk Principal"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          URI SIP *
                        </label>
                        <input
                          type="text"
                          required
                          value={accountFormData.trunk_uri}
                          onChange={(e) => setAccountFormData({ ...accountFormData, trunk_uri: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="sip:username@provider.com"
                          pattern="sips?:.+@.+"
                          title="Format: sip:username@provider.com ou sips:username@provider.com"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Format: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">sip:username@provider.com</code> ou <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">sips:username@provider.com</code>
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Nom d'utilisateur
                        </label>
                        <input
                          type="text"
                          value={accountFormData.username}
                          onChange={(e) => setAccountFormData({ ...accountFormData, username: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Mot de passe
                        </label>
                        <input
                          type="password"
                          value={accountFormData.password}
                          onChange={(e) => setAccountFormData({ ...accountFormData, password: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder={editingAccountId ? "(laisser vide pour ne pas changer)" : ""}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Hôte de contact
                        </label>
                        <input
                          type="text"
                          value={accountFormData.contact_host}
                          onChange={(e) => setAccountFormData({ ...accountFormData, contact_host: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="votre-ip-publique.com"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Port de contact
                        </label>
                        <input
                          type="number"
                          value={accountFormData.contact_port}
                          onChange={(e) => setAccountFormData({ ...accountFormData, contact_port: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="5060"
                          min="1"
                          max="65535"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Transport
                        </label>
                        <select
                          value={accountFormData.contact_transport}
                          onChange={(e) => setAccountFormData({ ...accountFormData, contact_transport: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="udp">UDP</option>
                          <option value="tcp">TCP</option>
                          <option value="tls">TLS</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={accountFormData.is_default}
                          onChange={(e) => setAccountFormData({ ...accountFormData, is_default: e.target.checked })}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          Compte par défaut
                        </span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={accountFormData.is_active}
                          onChange={(e) => setAccountFormData({ ...accountFormData, is_active: e.target.checked })}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          Actif
                        </span>
                      </label>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={isSavingAccount}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingAccount ? "Enregistrement..." : isCreatingAccount ? "Créer" : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelAccount}
                        disabled={isSavingAccount}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {accountsLoading ? (
                <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                  Chargement...
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Aucun compte SIP configuré
                  </p>
                  {!isCreatingAccount && (
                    <button
                      onClick={handleCreateAccount}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Ajouter le premier compte
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Label
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          URI
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Utilisateur
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Transport
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Statut
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {accounts.map((account) => (
                        <tr key={account.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {account.label}
                              </span>
                              {account.is_default && (
                                <span className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded">
                                  Défaut
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {account.trunk_uri}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {account.username || "-"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {account.contact_transport?.toUpperCase() || "UDP"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 text-xs rounded ${
                                account.is_active
                                  ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                              }`}
                            >
                              {account.is_active ? "Actif" : "Inactif"}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => handleEditAccount(account)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4"
                            >
                              Modifier
                            </button>
                            <button
                              onClick={() => handleDeleteAccount(account.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
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
            </div>
          )}

          {/* Telephony Routes Tab */}
          {activeTab === "routes" && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Gestion des routes de téléphonie
                </h2>
                {!isCreatingRoute && !editingRouteId && (
                  <button
                    onClick={handleCreateRoute}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    + Ajouter une route
                  </button>
                )}
              </div>

              {routeError && (
                <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg">
                  {routeError}
                </div>
              )}

              {routeSuccess && (
                <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-lg">
                  {routeSuccess}
                </div>
              )}

              {(isCreatingRoute || editingRouteId) && (
                <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                    {isCreatingRoute ? "Nouvelle route" : "Modifier la route"}
                  </h3>
                  <form onSubmit={handleSubmitRoute} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Numéro de téléphone *
                        </label>
                        <input
                          type="text"
                          required
                          value={routeFormData.phone_number}
                          onChange={(e) => setRouteFormData({ ...routeFormData, phone_number: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="+33123456789"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Workflow Slug
                        </label>
                        <input
                          type="text"
                          value={routeFormData.workflow_slug}
                          onChange={(e) => setRouteFormData({ ...routeFormData, workflow_slug: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="my-workflow"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Workflow ID
                        </label>
                        <input
                          type="number"
                          value={routeFormData.workflow_id}
                          onChange={(e) => setRouteFormData({ ...routeFormData, workflow_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="1"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={isSavingRoute}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSavingRoute ? "Enregistrement..." : isCreatingRoute ? "Créer" : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRoute}
                        disabled={isSavingRoute}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {routesLoading ? (
                <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                  Chargement...
                </div>
              ) : routes.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Aucune route configurée
                  </p>
                  {!isCreatingRoute && (
                    <button
                      onClick={handleCreateRoute}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Ajouter la première route
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Numéro
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Workflow Slug
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Workflow ID
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {routes.map((route) => (
                        <tr key={route.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {route.phone_number}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {route.workflow_slug || "-"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {route.workflow_id || "-"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => handleEditRoute(route)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4"
                            >
                              Modifier
                            </button>
                            <button
                              onClick={() => handleDeleteRoute(route.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
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
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === "settings" && (
            <div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  Paramètres SIP Globaux
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Les paramètres SIP globaux (compatibilité avec l'ancien système) sont configurés dans les paramètres d'application.
                </p>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  <strong>Note :</strong> Si vous avez des comptes SIP configurés dans l'onglet "Comptes SIP", ils seront utilisés en priorité.
                  Les paramètres globaux ne sont utilisés que si aucun compte SIP n'est configuré en base de données.
                </p>
                <a
                  href="/admin/settings"
                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Ouvrir les paramètres d'application
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </ManagementPageLayout>
  );
};
