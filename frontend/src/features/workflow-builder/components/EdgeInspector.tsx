import type { CSSProperties } from "react";

import type { FlowEdge } from "../types";

const conditionOptions = [
  { value: "", label: "(par défaut)" },
  { value: "true", label: "Branche true" },
  { value: "false", label: "Branche false" },
];

export type EdgeInspectorProps = {
  edge: FlowEdge;
  onConditionChange: (edgeId: string, value: string) => void;
  onLabelChange: (edgeId: string, value: string) => void;
  onRemove: (edgeId: string) => void;
};

const EdgeInspector = ({ edge, onConditionChange, onLabelChange, onRemove }: EdgeInspectorProps) => (
  <section aria-label="Propriétés de l'arête sélectionnée">
    <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Connexion sélectionnée</h2>
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
      <dt>Depuis</dt>
      <dd>{edge.source}</dd>
      <dt>Vers</dt>
      <dd>{edge.target}</dd>
    </dl>
    <label style={fieldStyle}>
      <span>Branche conditionnelle</span>
      <select
        value={edge.data?.condition ?? ""}
        onChange={(event) => onConditionChange(edge.id, event.target.value)}
      >
        {conditionOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <label style={fieldStyle}>
      <span>Libellé affiché</span>
      <input
        type="text"
        value={edge.label ?? ""}
        onChange={(event) => onLabelChange(edge.id, event.target.value)}
      />
    </label>
    <button type="button" className="btn danger" onClick={() => onRemove(edge.id)}>
      Supprimer cette connexion
    </button>
  </section>
);

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  marginTop: "0.75rem",
};

export default EdgeInspector;
