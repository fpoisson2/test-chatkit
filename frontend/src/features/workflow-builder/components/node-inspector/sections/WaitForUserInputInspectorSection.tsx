import styles from "../NodeInspector.module.css";

type WaitForUserInputInspectorSectionProps = {
  nodeId: string;
  waitForUserInputMessage: string;
  onWaitForUserInputMessageChange: (nodeId: string, value: string) => void;
  waitForUserInputMasked: boolean;
  onWaitForUserInputMaskedChange: (nodeId: string, value: boolean) => void;
};

export const WaitForUserInputInspectorSection = ({
  nodeId,
  waitForUserInputMessage,
  onWaitForUserInputMessageChange,
  waitForUserInputMasked,
  onWaitForUserInputMaskedChange,
}: WaitForUserInputInspectorSectionProps) => (
  <section
    aria-label="Configuration de l'attente utilisateur"
    className={styles.nodeInspectorPanelSpacious}
  >
    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>Message diffusé avant l'attente</span>
      <textarea
        value={waitForUserInputMessage}
        onChange={(event) => onWaitForUserInputMessageChange(nodeId, event.target.value)}
        rows={4}
        placeholder="Ex. Prenez le temps de me transmettre les informations manquantes."
        className={styles.nodeInspectorTextarea}
      />
      <p className={styles.nodeInspectorHintTextTight}>
        Laisser le champ vide n'enverra aucun nouveau message avant l'attente : seule la pause sera appliquée.
      </p>
    </label>
    <label className={styles.nodeInspectorField} style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
      <input
        type="checkbox"
        checked={waitForUserInputMasked}
        onChange={(event) => onWaitForUserInputMaskedChange(nodeId, event.target.checked)}
      />
      <span className={styles.nodeInspectorLabel} style={{ marginBottom: 0 }}>
        Masquer la saisie (mot de passe)
      </span>
    </label>
  </section>
);
