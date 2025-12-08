import styles from "../NodeInspector.module.css";

type DocxTemplateInspectorSectionProps = {
  templatePath: string;
  outputPath: string;
  dataText: string;
  dataError: string | null;
  onTemplatePathChange: (value: string) => void;
  onOutputPathChange: (value: string) => void;
  onDataDraftChange: (value: string) => void;
  onDataCommit: (value?: string) => void;
};

export const DocxTemplateInspectorSection = ({
  templatePath,
  outputPath,
  dataText,
  dataError,
  onTemplatePathChange,
  onOutputPathChange,
  onDataDraftChange,
  onDataCommit,
}: DocxTemplateInspectorSectionProps) => (
  <section
    aria-label="Configuration du bloc DOCX"
    className={styles.nodeInspectorPanelSpacious}
  >
    <label className={styles.nodeInspectorInputGroup}>
      <span className={styles.nodeInspectorLabel}>Modèle DOCX</span>
      <input
        type="text"
        value={templatePath}
        placeholder="/chemin/vers/modele.docx"
        onChange={(event) => onTemplatePathChange(event.target.value)}
        className={styles.nodeInspectorInput}
      />
    </label>

    <label className={styles.nodeInspectorInputGroup}>
      <span className={styles.nodeInspectorLabel}>Nom de sortie (optionnel)</span>
      <input
        type="text"
        value={outputPath}
        placeholder="rapport_rempli.docx"
        onChange={(event) => onOutputPathChange(event.target.value)}
        className={styles.nodeInspectorInput}
      />
    </label>

    <label className={styles.nodeInspectorInputGroup}>
      <span className={styles.nodeInspectorLabel}>Données JSON</span>
      <textarea
        value={dataText}
        onChange={(event) => onDataDraftChange(event.target.value)}
        onBlur={(event) => onDataCommit(event.target.value)}
        rows={10}
        spellCheck={false}
        placeholder={`{\n  "user": {\n    "name": "Alice"\n  }\n}`}
        className={styles.nodeInspectorTextareaLarge}
      />
    </label>

    <p className={styles.nodeInspectorHintText}>
      Le JSON doit être un objet. Utilisez les variables du workflow (ex: <code>state</code>, <code>input</code>) pour alimenter le
      modèle.
    </p>

    {dataError ? <p className={styles.nodeInspectorErrorText}>{dataError}</p> : null}
  </section>
);
