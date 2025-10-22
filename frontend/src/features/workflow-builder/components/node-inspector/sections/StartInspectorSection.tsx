import { fieldStyle, labelContentStyle } from "../styles";
import { ToggleRow } from "../components/ToggleRow";

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
          <label style={fieldStyle}>
            <span style={labelContentStyle}>Message utilisateur initial</span>
            <textarea
              value={startAutoRunMessage}
              onChange={(event) => onStartAutoRunMessageChange(nodeId, event.target.value)}
              rows={3}
              placeholder="Ex. Bonjour, voici les informations de départ… (facultatif)"
              style={{ resize: "vertical", minHeight: "4.5rem" }}
              disabled={hasStartAutoRunAssistantMessage}
            />
            <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
              Ce message est transmis à l'agent lorsqu'un fil démarre sans saisie utilisateur. Saisir un message assistant ci-dessous
              effacera automatiquement ce contenu.
            </p>
          </label>

          <label style={fieldStyle}>
            <span style={labelContentStyle}>Message assistant initial</span>
            <textarea
              value={startAutoRunAssistantMessage}
              onChange={(event) =>
                onStartAutoRunAssistantMessageChange(nodeId, event.target.value)
              }
              rows={3}
              placeholder="Ex. Bonjour, je suis votre assistant… (facultatif)"
              style={{ resize: "vertical", minHeight: "4.5rem" }}
              disabled={hasStartAutoRunUserMessage}
            />
            <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
              Ce message est diffusé en tant que première réponse de l'assistant lorsque le démarrage automatique est déclenché. Ajoutez
              un message utilisateur ci-dessus pour désactiver cette réponse.
            </p>
          </label>
        </>
      ) : null}
    </>
  );
};
