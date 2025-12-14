import { useEffect, useState } from "react";
import { useI18n } from "../../../../../i18n";
import { useAuth } from "../../../../../auth";
import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

interface SipAccountAvailability {
  id: number;
  label: string;
  is_active: boolean;
  is_available: boolean;
  assigned_workflow_id: number | null;
  assigned_workflow_slug: string | null;
}

interface LTIRegistration {
  id: number;
  issuer: string;
  client_id: string;
}

type StartInspectorSectionProps = {
  nodeId: string;
  startAutoRun: boolean;
  startAutoRunMessage: string;
  startAutoRunAssistantMessage: string;
  startTelephonySipAccountId: number | null;
  startTelephonyRingTimeout: number;
  startTelephonySpeakFirst: boolean;
  ltiEnabled: boolean;
  ltiRegistrationIds: number[];
  ltiShowSidebar: boolean;
  ltiShowHeader: boolean;
  ltiEnableHistory: boolean;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
  onStartTelephonySipAccountIdChange: (nodeId: string, value: number | null) => void;
  onStartTelephonyRingTimeoutChange: (nodeId: string, value: number) => void;
  onStartTelephonySpeakFirstChange: (nodeId: string, value: boolean) => void;
  onLtiEnabledChange: (value: boolean) => void;
  onLtiRegistrationIdsChange: (value: number[]) => void;
  onLtiShowSidebarChange: (value: boolean) => void;
  onLtiShowHeaderChange: (value: boolean) => void;
  onLtiEnableHistoryChange: (value: boolean) => void;
  workflowId: number | null;
};

export const StartInspectorSection = ({
  nodeId,
  startAutoRun,
  startAutoRunMessage,
  startAutoRunAssistantMessage,
  startTelephonySipAccountId,
  startTelephonyRingTimeout,
  startTelephonySpeakFirst,
  ltiEnabled,
  ltiRegistrationIds,
  ltiShowSidebar,
  ltiShowHeader,
  ltiEnableHistory,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
  onStartTelephonySipAccountIdChange,
  onStartTelephonyRingTimeoutChange,
  onStartTelephonySpeakFirstChange,
  onLtiEnabledChange,
  onLtiRegistrationIdsChange,
  onLtiShowSidebarChange,
  onLtiShowHeaderChange,
  onLtiEnableHistoryChange,
  workflowId,
}: StartInspectorSectionProps) => {
  const { t } = useI18n();
  const { token } = useAuth();
  const [sipAccounts, setSipAccounts] = useState<SipAccountAvailability[]>([]);
  const [sipAccountsLoading, setSipAccountsLoading] = useState(false);
  const [ltiRegistrations, setLtiRegistrations] = useState<LTIRegistration[]>([]);
  const [ltiRegistrationsLoading, setLtiRegistrationsLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    setSipAccountsLoading(true);
    const params = new URLSearchParams();
    if (workflowId) {
      params.append("workflow_id", String(workflowId));
    }

    fetch(`/api/admin/sip-accounts/availability?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setSipAccounts(data))
      .catch(() => {})
      .finally(() => setSipAccountsLoading(false));
  }, [token, workflowId]);

  useEffect(() => {
    if (!token) return;

    setLtiRegistrationsLoading(true);
    fetch("/api/lti/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setLtiRegistrations(data))
      .catch(() => {})
      .finally(() => setLtiRegistrationsLoading(false));
  }, [token]);

  const hasStartAutoRunUserMessage = startAutoRunMessage.trim().length > 0;
  const hasStartAutoRunAssistantMessage = startAutoRunAssistantMessage.trim().length > 0;

  return (
    <>
      <ToggleRow
        label={t("workflowBuilder.startInspector.autoRunLabel")}
        checked={startAutoRun}
        onChange={(next) => onStartAutoRunChange(nodeId, next)}
        help={t("workflowBuilder.startInspector.autoRunHelp")}
      />

      {startAutoRun ? (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.autoRunUserMessageLabel")}
            </span>
            <textarea
              value={startAutoRunMessage}
              onChange={(event) => onStartAutoRunMessageChange(nodeId, event.target.value)}
              rows={3}
              placeholder={t("workflowBuilder.startInspector.autoRunUserMessagePlaceholder")}
              className={styles.nodeInspectorTextarea}
              disabled={hasStartAutoRunAssistantMessage}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.autoRunUserMessageHint")}
            </p>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.autoRunAssistantMessageLabel")}
            </span>
            <textarea
              value={startAutoRunAssistantMessage}
              onChange={(event) =>
                onStartAutoRunAssistantMessageChange(nodeId, event.target.value)
              }
              rows={3}
              placeholder={t(
                "workflowBuilder.startInspector.autoRunAssistantMessagePlaceholder",
              )}
              className={styles.nodeInspectorTextarea}
              disabled={hasStartAutoRunUserMessage}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.autoRunAssistantMessageHint")}
            </p>
          </label>
        </>
      ) : null}

      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Compte SIP
        </span>
        <select
          value={startTelephonySipAccountId || ""}
          onChange={(event) => {
            const value = event.target.value;
            onStartTelephonySipAccountIdChange(nodeId, value ? parseInt(value, 10) : null);
          }}
          disabled={sipAccountsLoading}
        >
          <option value="">Aucun (workflow sans téléphonie)</option>
          {sipAccounts.map((account) => (
            <option
              key={account.id}
              value={account.id}
              disabled={!account.is_available}
            >
              {account.label}
              {!account.is_available && account.assigned_workflow_slug
                ? ` (assigné à ${account.assigned_workflow_slug})`
                : ""}
            </option>
          ))}
        </select>
        <p className={styles.nodeInspectorHintTextTight}>
          Sélectionnez le compte SIP pour ce workflow. Un compte SIP ne peut être associé qu'à un seul workflow.
        </p>
      </label>

      {startTelephonySipAccountId ? (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>
              {t("workflowBuilder.startInspector.telephonyRingTimeoutLabel")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={startTelephonyRingTimeout}
                onChange={(event) => {
                  const value = parseFloat(event.target.value);
                  if (!isNaN(value) && value >= 0) {
                    onStartTelephonyRingTimeoutChange(nodeId, value);
                  }
                }}
                placeholder="0"
                style={{ width: "120px" }}
              />
              <span style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>secondes</span>
            </div>
            <p className={styles.nodeInspectorHintTextTight}>
              {t("workflowBuilder.startInspector.telephonyRingTimeoutHelp")}
            </p>
          </label>

          <ToggleRow
            label="L'assistant parle en premier"
            checked={startTelephonySpeakFirst}
            onChange={(checked) => onStartTelephonySpeakFirstChange(nodeId, checked)}
            help="Quand activé, l'assistant vocal commence à parler immédiatement après avoir répondu à l'appel, sans attendre que l'appelant parle en premier."
          />
        </>
      ) : null}

      <ToggleRow
        label="Activer LTI"
        checked={ltiEnabled}
        onChange={onLtiEnabledChange}
        help="Permet à ce workflow d'être utilisé via LTI (Learning Tools Interoperability) par les plateformes autorisées."
      />

      {ltiEnabled && (
        <div className={styles.nodeInspectorField}>
          <span className={styles.nodeInspectorLabel}>
            Plateformes LTI autorisées
          </span>
          {ltiRegistrationsLoading ? (
            <p>Chargement des plateformes LTI...</p>
          ) : ltiRegistrations.length === 0 ? (
            <p className={styles.nodeInspectorHintTextTight}>
              Aucune plateforme LTI configurée. Configurez une plateforme LTI dans les paramètres d'administration.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {ltiRegistrations.map((registration) => (
                <label key={registration.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={ltiRegistrationIds.includes(registration.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onLtiRegistrationIdsChange([...ltiRegistrationIds, registration.id]);
                      } else {
                        onLtiRegistrationIdsChange(
                          ltiRegistrationIds.filter((id) => id !== registration.id)
                        );
                      }
                    }}
                  />
                  <span style={{ fontSize: "14px" }}>{registration.issuer}</span>
                </label>
              ))}
            </div>
          )}
          <p className={styles.nodeInspectorHintTextTight}>
            Sélectionnez les plateformes LTI autorisées à utiliser ce workflow. Si aucune plateforme n'est sélectionnée, toutes les plateformes pourront utiliser ce workflow.
          </p>
        </div>
      )}

      {ltiEnabled && (
        <>
          <ToggleRow
            label="Afficher la sidebar"
            checked={ltiShowSidebar}
            onChange={onLtiShowSidebarChange}
            help="Affiche la barre latérale dans ChatKit lors d'un lancement LTI."
          />

          <ToggleRow
            label="Afficher le header ChatKit"
            checked={ltiShowHeader}
            onChange={onLtiShowHeaderChange}
            help="Affiche l'en-tête de ChatKit lors d'un lancement LTI."
          />

          <ToggleRow
            label="Activer l'historique"
            checked={ltiEnableHistory}
            onChange={onLtiEnableHistoryChange}
            help="Permet l'accès à l'historique des conversations dans ChatKit lors d'un lancement LTI."
          />
        </>
      )}
    </>
  );
};
