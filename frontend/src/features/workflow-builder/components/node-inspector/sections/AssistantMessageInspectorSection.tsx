import { fieldStyle, labelContentStyle } from "../styles";

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
    <label style={fieldStyle}>
      <span style={labelContentStyle}>Texte du message assistant</span>
      <textarea
        value={assistantMessage}
        onChange={(event) => onAssistantMessageChange(nodeId, event.target.value)}
        rows={4}
        placeholder="Texte affiché aux utilisateurs lorsque ce bloc est exécuté"
        style={{ resize: "vertical", minHeight: "4.5rem" }}
      />
      <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
        Ce message est diffusé tel quel dans la conversation avant de passer au bloc suivant.
      </p>
    </label>

    <label style={{ ...fieldStyle, marginTop: "0.75rem" }}>
      <span style={labelContentStyle}>Effet de streaming</span>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <input
          type="checkbox"
          checked={assistantMessageStreamEnabled}
          onChange={(event) => onAssistantMessageStreamEnabledChange(nodeId, event.target.checked)}
        />
        <div style={{ lineHeight: 1.4 }}>
          <strong>Simuler une réponse progressive</strong>
          <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
            Quand cette option est active, le texte est diffusé en plusieurs morceaux dans le chat afin d'imiter la frappe d'un
            agent.
          </p>
        </div>
      </div>
    </label>

    {assistantMessageStreamEnabled ? (
      <label style={fieldStyle}>
        <span style={labelContentStyle}>Délai entre les paquets (ms)</span>
        <input
          type="number"
          min={0}
          step={10}
          value={String(assistantMessageStreamDelay)}
          onChange={(event) => onAssistantMessageStreamDelayChange(nodeId, event.target.value)}
        />
        <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
          Ajustez le temps d'attente entre chaque mise à jour envoyée aux utilisateurs.
        </p>
      </label>
    ) : null}
  </>
);
