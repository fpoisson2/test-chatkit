import styles from "../NodeInspector.module.css";

type TransformInspectorSectionProps = {
  transformExpressionsText: string;
  transformExpressionsError: string | null;
  onDraftChange: (value: string) => void;
  onCommit: (value?: string) => void;
  onResetError: () => void;
};

export const TransformInspectorSection = ({
  transformExpressionsText,
  transformExpressionsError,
  onDraftChange,
  onCommit,
  onResetError,
}: TransformInspectorSectionProps) => (
  <section
    aria-label="Configuration du bloc transform"
    className={styles.nodeInspectorPanelSpacious}
  >
    <label className={styles.nodeInspectorInputGroup}>
      <span className={styles.nodeInspectorLabel}>Expressions JSON</span>
      <textarea
        value={transformExpressionsText}
        onChange={(event) => {
          onDraftChange(event.target.value);
          onResetError();
        }}
        onBlur={(event) => onCommit(event.target.value)}
        rows={10}
        spellCheck={false}
        placeholder={`{\n  "doc_id": "{{ input.output_structured.id }}",\n  "record": {\n    "slug": "{{ input.output_structured.widget }}"\n  }\n}`}
        className={styles.nodeInspectorTextareaLarge}
      />
    </label>

    <p className={styles.nodeInspectorHintText}>
      Le JSON final doit être un objet. Utilisez <code>state.</code> ou <code>input.</code> pour accéder aux variables du workflow.
    </p>

    {transformExpressionsError ? (
      <p className={styles.nodeInspectorErrorText}>{transformExpressionsError}</p>
    ) : null}
  </section>
);
