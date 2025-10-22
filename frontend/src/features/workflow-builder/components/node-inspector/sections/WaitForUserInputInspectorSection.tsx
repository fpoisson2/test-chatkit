import { fieldStyle, labelContentStyle } from "../styles";

type WaitForUserInputInspectorSectionProps = {
  nodeId: string;
  waitForUserInputMessage: string;
  onWaitForUserInputMessageChange: (nodeId: string, value: string) => void;
};

export const WaitForUserInputInspectorSection = ({
  nodeId,
  waitForUserInputMessage,
  onWaitForUserInputMessageChange,
}: WaitForUserInputInspectorSectionProps) => (
  <section
    aria-label="Configuration de l'attente utilisateur"
    style={{
      marginTop: "1rem",
      border: "1px solid rgba(15, 23, 42, 0.12)",
      borderRadius: "0.75rem",
      padding: "0.9rem",
      display: "grid",
      gap: "0.75rem",
    }}
  >
    <header>
      <h3 style={{ margin: 0, fontSize: "1rem" }}>Attendre une réponse</h3>
      <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>
        Utilisez ce bloc pour suspendre le workflow jusqu'à la prochaine saisie utilisateur. Un message assistant optionnel peut
        préparer la relance.
      </p>
    </header>
    <label style={fieldStyle}>
      <span style={labelContentStyle}>Message diffusé avant l'attente</span>
      <textarea
        value={waitForUserInputMessage}
        onChange={(event) => onWaitForUserInputMessageChange(nodeId, event.target.value)}
        rows={4}
        placeholder="Ex. Prenez le temps de me transmettre les informations manquantes."
        style={{ resize: "vertical", minHeight: "4.5rem" }}
      />
      <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
        Laisser le champ vide n'enverra aucun nouveau message avant l'attente : seule la pause sera appliquée.
      </p>
    </label>
  </section>
);
