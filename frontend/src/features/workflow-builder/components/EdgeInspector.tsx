import type { CSSProperties } from "react";

import type { FlowEdge } from "../types";

export type EdgeInspectorProps = {
  edge: FlowEdge;
  onConditionChange: (edgeId: string, value: string) => void;
  onLabelChange: (edgeId: string, value: string) => void;
  onRemove: (edgeId: string) => void;
};

const EdgeInspector = ({ edge, onConditionChange, onLabelChange, onRemove }: EdgeInspectorProps) => (
  <section aria-label="Propriétés de l'arête sélectionnée">
    <div style={inspectorHeaderStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        <span style={inspectorTitleStyle}>Connexion sélectionnée</span>
        <span style={inspectorSubtitleStyle}>
          {edge.source} → {edge.target}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onRemove(edge.id)}
        style={deleteButtonStyle}
        aria-label="Supprimer cette connexion"
        title="Supprimer cette connexion"
      >
        <TrashIcon />
      </button>
    </div>
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
      <dt>Depuis</dt>
      <dd>{edge.source}</dd>
      <dt>Vers</dt>
      <dd>{edge.target}</dd>
    </dl>
    <label style={fieldStyle}>
      <span>Branche conditionnelle</span>
      <input
        type="text"
        value={edge.data?.condition ?? ""}
        onChange={(event) => onConditionChange(edge.id, event.target.value)}
        placeholder="Laisser vide pour la branche par défaut"
      />
    </label>
    <p style={{ color: "#475569", margin: "0.35rem 0 0" }}>
      Attribuez un nom unique (ex. approuve, rejeté). Laissez vide pour définir la branche par défaut.
    </p>
    <label style={fieldStyle}>
      <span>Libellé affiché</span>
      <input
        type="text"
        value={edge.label ?? ""}
        onChange={(event) => onLabelChange(edge.id, event.target.value)}
      />
    </label>
  </section>
);

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  marginTop: "0.75rem",
};

const inspectorHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  marginBottom: "1rem",
};

const inspectorTitleStyle: CSSProperties = {
  fontSize: "1.1rem",
  fontWeight: 700,
  color: "#0f172a",
};

const inspectorSubtitleStyle: CSSProperties = {
  fontSize: "0.85rem",
  color: "#475569",
};

const deleteButtonStyle: CSSProperties = {
  border: "1px solid rgba(220, 38, 38, 0.25)",
  backgroundColor: "rgba(220, 38, 38, 0.12)",
  color: "#b91c1c",
  borderRadius: "9999px",
  padding: "0.35rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(220, 38, 38, 0.2)",
  transition: "background-color 150ms ease, transform 150ms ease",
};

const deleteButtonIconStyle: CSSProperties = {
  width: "1.1rem",
  height: "1.1rem",
};

const TrashIcon = () => (
  <svg
    style={deleteButtonIconStyle}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M9 3h6a1 1 0 0 1 1 1v1h4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 5h14l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M10 10v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14 10v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export default EdgeInspector;
