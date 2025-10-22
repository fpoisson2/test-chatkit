import { ToggleRow } from "../components/ToggleRow";
import styles from "../NodeInspector.module.css";

type StartInspectorSectionProps = {
  nodeId: string;
  startAutoRun: boolean;
  startAutoRunMessage: string;
  startAutoRunAssistantMessage: string;
  onStartAutoRunChange: (nodeId: string, value: boolean) => void;
  onStartAutoRunMessageChange: (nodeId: string, value: string) => void;
  onStartAutoRunAssistantMessageChange: (nodeId: string, value: string) => void;
};

export const StartInspectorSection = ({
  nodeId,
  startAutoRun,
  startAutoRunMessage,
  startAutoRunAssistantMessage,
  onStartAutoRunChange,
  onStartAutoRunMessageChange,
  onStartAutoRunAssistantMessageChange,
}: StartInspectorSectionProps) => {
  const hasStartAutoRunUserMessage = startAutoRunMessage.trim().length > 0;
  const hasStartAutoRunAssistantMessage = startAutoRunAssistantMessage.trim().length > 0;

  return (
    <>
      <ToggleRow
        label="Démarrer automatiquement"
        checked={startAutoRun}
        onChange={(next) => onStartAutoRunChange(nodeId, next)}
        help="Exécute immédiatement le workflow lors de l'ouverture d'un fil, même sans message utilisateur."
      />

      {startAutoRun ? (
        <>
          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>Message utilisateur initial</span>
            <textarea
              value={startAutoRunMessage}
              onChange={(event) => onStartAutoRunMessageChange(nodeId, event.target.value)}
              rows={3}
              placeholder="Ex. Bonjour, voici les informations de départ… (facultatif)"
              className={styles.nodeInspectorTextarea}
              disabled={hasStartAutoRunAssistantMessage}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              Ce message est transmis à l'agent lorsqu'un fil démarre sans saisie utilisateur. Saisir un message assistant ci-dessous
              effacera automatiquement ce contenu.
            </p>
          </label>

          <label className={styles.nodeInspectorField}>
            <span className={styles.nodeInspectorLabel}>Message assistant initial</span>
            <textarea
              value={startAutoRunAssistantMessage}
              onChange={(event) =>
                onStartAutoRunAssistantMessageChange(nodeId, event.target.value)
              }
              rows={3}
              placeholder="Ex. Bonjour, je suis votre assistant… (facultatif)"
              className={styles.nodeInspectorTextarea}
              disabled={hasStartAutoRunUserMessage}
            />
            <p className={styles.nodeInspectorHintTextTight}>
              Ce message est diffusé en tant que première réponse de l'assistant lorsque le démarrage automatique est déclenché. Ajoutez
              un message utilisateur ci-dessus pour désactiver cette réponse.
            </p>
          </label>
        </>
      ) : null}
    </>
  );
};
