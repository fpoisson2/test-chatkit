import styles from "../NodeInspector.module.css";

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
    className={styles.nodeInspectorPanelSpacious}
  >
    <header>
      <h3 className={styles.nodeInspectorSectionHeading}>Attendre une réponse</h3>
      <p className={styles.nodeInspectorMutedTextHighlight}>
        Utilisez ce bloc pour suspendre le workflow jusqu'à la prochaine saisie utilisateur. Un message assistant optionnel peut
        préparer la relance.
      </p>
    </header>
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
  </section>
);
