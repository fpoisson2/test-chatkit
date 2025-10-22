import { labelContentStyle } from "../styles";

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
    style={{
      marginTop: "1rem",
      border: "1px solid rgba(15, 23, 42, 0.12)",
      borderRadius: "0.75rem",
      padding: "0.9rem",
      display: "grid",
      gap: "0.75rem",
    }}
  >
    <header>
      <h3 style={{ margin: 0, fontSize: "1rem" }}>Restructuration des données</h3>
      <p style={{ margin: "0.25rem 0 0", color: "#475569", fontSize: "0.95rem" }}>
        Définissez la forme JSON qui doit être transmise au bloc suivant. Les expressions <code style={{ padding: "0 0.2rem" }}>
          {{"{{ }}"}}
        </code>{" "}
        sont évaluées à partir du contexte du bloc précédent (par exemple <code>{{"{{ input.output_structured }}"}}</code>).
      </p>
    </header>

    <label style={{ display: "grid", gap: "0.5rem" }}>
      <span style={{ ...labelContentStyle, fontWeight: 600 }}>Expressions JSON</span>
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
        style={{ resize: "vertical", fontFamily: "var(--font-mono)", minHeight: "12rem" }}
      />
    </label>

    <p style={{ color: "var(--text-muted)", margin: "-0.35rem 0 0.35rem" }}>
      Le JSON final doit être un objet. Utilisez <code>state.</code> ou <code>input.</code> pour accéder aux variables du workflow.
    </p>

    {transformExpressionsError ? (
      <p style={{ color: "#b91c1c", margin: 0 }}>{transformExpressionsError}</p>
    ) : null}
  </section>
);
