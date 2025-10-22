import { fieldStyle, labelContentStyle } from "../styles";

type UserMessageInspectorSectionProps = {
  nodeId: string;
  userMessageDraft: string;
  onUserMessageDraftChange: (nodeId: string, value: string) => void;
};

export const UserMessageInspectorSection = ({
  nodeId,
  userMessageDraft,
  onUserMessageDraftChange,
}: UserMessageInspectorSectionProps) => (
  <label style={fieldStyle}>
    <span style={labelContentStyle}>Texte du message utilisateur</span>
    <textarea
      value={userMessageDraft}
      onChange={(event) => onUserMessageDraftChange(nodeId, event.target.value)}
      rows={4}
      placeholder="Texte injecté dans la conversation comme message utilisateur"
      style={{ resize: "vertical", minHeight: "4.5rem" }}
    />
    <p style={{ color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
      Ce message est transmis à l'agent comme s'il provenait directement de l'utilisateur avant de passer au bloc suivant.
    </p>
  </label>
);
