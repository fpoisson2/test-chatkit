import styles from "../NodeInspector.module.css";

type AssistantMessageInspectorSectionProps = {
  nodeId: string;
  assistantMessage: string;
  assistantMessageStreamEnabled: boolean;
  assistantMessageStreamDelay: number;
  onAssistantMessageChange: (nodeId: string, value: string) => void;
  onAssistantMessageStreamEnabledChange: (nodeId: string, value: boolean) => void;
  onAssistantMessageStreamDelayChange: (nodeId: string, value: string) => void;
};

export const AssistantMessageInspectorSection = ({
  nodeId,
  assistantMessage,
  assistantMessageStreamEnabled,
  assistantMessageStreamDelay,
  onAssistantMessageChange,
  onAssistantMessageStreamEnabledChange,
  onAssistantMessageStreamDelayChange,
}: AssistantMessageInspectorSectionProps) => (
  <>
    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>Texte du message assistant</span>
      <textarea
        value={assistantMessage}
        onChange={(event) => onAssistantMessageChange(nodeId, event.target.value)}
        rows={4}
        placeholder="Texte affiché aux utilisateurs lorsque ce bloc est exécuté"
        className={styles.nodeInspectorTextarea}
      />
      <p className={styles.nodeInspectorHintTextTight}>
        Ce message est diffusé tel quel dans la conversation avant de passer au bloc suivant.
      </p>
    </label>

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>Effet de streaming</span>
      <div className={styles.nodeInspectorInlineStack}>
        <input
          type="checkbox"
          checked={assistantMessageStreamEnabled}
          onChange={(event) => onAssistantMessageStreamEnabledChange(nodeId, event.target.checked)}
        />
        <div className={styles.nodeInspectorStackText}>
          <strong>Simuler une réponse progressive</strong>
          <p className={styles.nodeInspectorHintTextTight}>
            Quand cette option est active, le texte est diffusé en plusieurs morceaux dans le chat afin d'imiter la frappe d'un
            agent.
          </p>
        </div>
      </div>
    </label>

    {assistantMessageStreamEnabled ? (
      <label className={styles.nodeInspectorField}>
        <span className={styles.nodeInspectorLabel}>Délai entre les paquets (ms)</span>
        <input
          type="number"
          min={0}
          step={10}
          value={String(assistantMessageStreamDelay)}
          onChange={(event) => onAssistantMessageStreamDelayChange(nodeId, event.target.value)}
        />
        <p className={styles.nodeInspectorHintTextTight}>
          Ajustez le temps d'attente entre chaque mise à jour envoyée aux utilisateurs.
        </p>
      </label>
    ) : null}
  </>
);
