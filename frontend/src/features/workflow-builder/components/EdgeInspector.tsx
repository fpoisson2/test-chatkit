import type { CSSProperties } from "react";

import { useI18n } from "../../../i18n";

import type { FlowEdge } from "../types";

export type EdgeInspectorProps = {
  edge: FlowEdge;
  onConditionChange: (edgeId: string, value: string) => void;
  onLabelChange: (edgeId: string, value: string) => void;
  onRemove: (edgeId: string) => void;
};

const EdgeInspector = ({ edge, onConditionChange, onLabelChange, onRemove }: EdgeInspectorProps) => {
  const { t } = useI18n();
  return (
    <section aria-label={t("Propriétés de l'arête sélectionnée")}>
      <div style={inspectorHeaderStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          <span style={inspectorTitleStyle}>{t("Connexion sélectionnée")}</span>
          <span style={inspectorSubtitleStyle}>
            {edge.source} → {edge.target}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onRemove(edge.id)}
          style={deleteButtonStyle}
          aria-label={t("Supprimer cette connexion")}
          title={t("Supprimer cette connexion")}
        >
          <TrashIcon />
        </button>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem" }}>
        <dt>{t("Depuis")}</dt>
        <dd>{edge.source}</dd>
        <dt>{t("Vers")}</dt>
        <dd>{edge.target}</dd>
      </dl>
      <label style={fieldStyle}>
        <span>{t("Branche conditionnelle")}</span>
        <input
          type="text"
          value={edge.data?.condition ?? ""}
          onChange={(event) => onConditionChange(edge.id, event.target.value)}
          placeholder={t("Laisser vide pour la branche par défaut")}
        />
      </label>
      <p style={{ color: "var(--color-text-muted)", margin: "0.35rem 0 0" }}>
        {t(
          "Attribuez un nom unique (ex. approuve, rejeté). Laissez vide pour définir la branche par défaut.",
        )}
      </p>
      <label style={fieldStyle}>
        <span>{t("Libellé affiché")}</span>
        <input
          type="text"
          value={edge.label ?? ""}
          onChange={(event) => onLabelChange(edge.id, event.target.value)}
        />
      </label>
    </section>
  );
};

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
  color: "var(--color-text-strong)",
};

const inspectorSubtitleStyle: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text-muted)",
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
