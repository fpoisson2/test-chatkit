import { useState, useEffect } from "react";
import { useAuth } from "../../../../../auth";
import styles from "../NodeInspector.module.css";

type OutboundCallInspectorSectionProps = {
  nodeId: string;
  parameters: Record<string, unknown>;
  onParametersChange: (nodeId: string, parameters: Record<string, unknown>) => void;
};

type WorkflowSummary = {
  id: number;
  slug: string;
  display_name: string | null;
};

type SipAccountSummary = {
  id: number;
  label: string;
  is_active: boolean;
};

export const OutboundCallInspectorSection = ({
  nodeId,
  parameters,
  onParametersChange,
}: OutboundCallInspectorSectionProps) => {
  const { token } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [sipAccounts, setSipAccounts] = useState<SipAccountSummary[]>([]);
  const [loading, setLoading] = useState(false);

  // Charger les workflows (tous pour l'instant, on pourrait filtrer ceux avec voice_agent)
  useEffect(() => {
    if (!token) return;

    setLoading(true);
    fetch("/api/admin/workflows", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setWorkflows(data);
        }
      })
      .catch((err) => console.error("Failed to load workflows:", err))
      .finally(() => setLoading(false));
  }, [token]);

  // Charger les comptes SIP
  useEffect(() => {
    if (!token) return;

    fetch("/api/admin/sip-accounts", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSipAccounts(data.filter((acc) => acc.is_active));
        }
      })
      .catch((err) => console.error("Failed to load SIP accounts:", err));
  }, [token]);

  const toNumber = (parameters.to_number as string) || "";
  const voiceWorkflowId = (parameters.voice_workflow_id as number) || null;
  const sipAccountId = (parameters.sip_account_id as number) || null;
  const waitForCompletion = (parameters.wait_for_completion as boolean) ?? true;

  const handleToNumberChange = (value: string) => {
    onParametersChange(nodeId, { ...parameters, to_number: value });
  };

  const handleVoiceWorkflowChange = (value: string) => {
    onParametersChange(nodeId, {
      ...parameters,
      voice_workflow_id: value ? parseInt(value, 10) : null,
    });
  };

  const handleSipAccountChange = (value: string) => {
    onParametersChange(nodeId, {
      ...parameters,
      sip_account_id: value ? parseInt(value, 10) : null,
    });
  };

  const handleWaitForCompletionChange = (checked: boolean) => {
    onParametersChange(nodeId, { ...parameters, wait_for_completion: checked });
  };

  return (
    <div>
      <h3 className={styles.nodeInspectorSectionTitle}>
        Configuration de l'appel sortant
      </h3>

      {/* Numéro à appeler */}
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Numéro à appeler <span style={{ color: "red" }}>*</span>
        </span>
        <input
          type="text"
          value={toNumber}
          onChange={(e) => handleToNumberChange(e.target.value)}
          placeholder="+33612345678"
          className={styles.nodeInspectorInput}
        />
        <p className={styles.nodeInspectorHintTextTight}>
          Numéro au format E.164 (ex: +33612345678). Peut utiliser une variable:{" "}
          {"{"}
          {"{"}state.phone_number{"}"}
          {"}"}
        </p>
      </label>

      {/* Workflow vocal */}
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>
          Workflow vocal <span style={{ color: "red" }}>*</span>
        </span>
        <select
          value={voiceWorkflowId || ""}
          onChange={(e) => handleVoiceWorkflowChange(e.target.value)}
          className={styles.nodeInspectorSelect}
          disabled={loading}
        >
          <option value="">Sélectionner un workflow...</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.display_name || w.slug}
            </option>
          ))}
        </select>
        <p className={styles.nodeInspectorHintTextTight}>
          Le workflow vocal qui sera exécuté lors de l'appel. Doit contenir un bloc
          voice_agent.
        </p>
      </label>

      {/* Compte SIP */}
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Compte SIP</span>
        <select
          value={sipAccountId || ""}
          onChange={(e) => handleSipAccountChange(e.target.value)}
          className={styles.nodeInspectorSelect}
        >
          <option value="">Par défaut</option>
          {sipAccounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.label}
            </option>
          ))}
        </select>
        <p className={styles.nodeInspectorHintTextTight}>
          Compte SIP à utiliser pour passer l'appel. Si vide, utilise le compte par
          défaut.
        </p>
      </label>

      {/* Attendre la fin de l'appel */}
      <label className={styles.nodeInspectorField}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={waitForCompletion}
            onChange={(e) => handleWaitForCompletionChange(e.target.checked)}
          />
          <span className={styles.nodeInspectorLabel}>
            Attendre la fin de l'appel
          </span>
        </div>
        <p className={styles.nodeInspectorHintTextTight}>
          Si coché, le workflow attend que l'appel se termine avant de continuer. Si
          décoché, l'appel est lancé en arrière-plan et le workflow continue
          immédiatement.
        </p>
      </label>

      {/* Info sur les résultats */}
      {waitForCompletion && (
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            backgroundColor: "#f5f5f5",
            borderRadius: "4px",
            fontSize: "13px",
          }}
        >
          <p style={{ fontWeight: "bold", marginBottom: "8px" }}>
            Résultat disponible après l'appel:
          </p>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            <li>
              <code>
                {"{"}
                {"{"}outbound_call.call_status{"}"}
                {"}"}
              </code>{" "}
              - Status: completed, no_answer, busy, failed
            </li>
            <li>
              <code>
                {"{"}
                {"{"}outbound_call.answered{"}"}
                {"}"}
              </code>{" "}
              - true si répondu, false sinon
            </li>
            <li>
              <code>
                {"{"}
                {"{"}outbound_call.duration_seconds{"}"}
                {"}"}
              </code>{" "}
              - Durée de l'appel
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};
