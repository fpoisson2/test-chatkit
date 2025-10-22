import styles from "../NodeInspector.module.css";

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
  <label className={styles.nodeInspectorField}>
    <span className={styles.nodeInspectorLabel}>Texte du message utilisateur</span>
    <textarea
      value={userMessageDraft}
      onChange={(event) => onUserMessageDraftChange(nodeId, event.target.value)}
      rows={4}
      placeholder="Texte injecté dans la conversation comme message utilisateur"
      className={styles.nodeInspectorTextarea}
    />
    <p className={styles.nodeInspectorHintTextTight}>
      Ce message est transmis à l'agent comme s'il provenait directement de l'utilisateur avant de passer au bloc suivant.
    </p>
  </label>
);
