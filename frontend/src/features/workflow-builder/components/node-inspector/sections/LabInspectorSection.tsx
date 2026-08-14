import { useMemo, useState } from "react";
import type { AgentParameters } from "../../../../types";
import styles from "../NodeInspector.module.css";
import { ToggleRow } from "../components/ToggleRow";

type Props = { parameters: AgentParameters; onParametersChange: (parameters: AgentParameters) => void };

export function LabInspectorSection({ parameters, onParametersChange }: Props) {
  const [jsonError, setJsonError] = useState<string | null>(null);
  const criteria = useMemo(() => JSON.stringify(parameters.criteria ?? [], null, 2), [parameters.criteria]);
  const sections = useMemo(() => JSON.stringify(parameters.sections ?? [], null, 2), [parameters.sections]);
  const update = (key: string, value: unknown) => onParametersChange({ ...parameters, [key]: value });
  const parseJson = (key: "criteria" | "sections", value: string) => {
    try { update(key, JSON.parse(value)); setJsonError(null); } catch { setJsonError(`JSON invalide pour ${key}.`); }
  };

  return <div className={styles.nodeInspectorPanel}>
    <strong className={styles.nodeInspectorSectionTitle}>Document de laboratoire</strong>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Titre</span><input value={String(parameters.title ?? "")} onChange={(event) => update("title", event.target.value)} /></label>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Consignes</span><textarea rows={4} value={String(parameters.introduction ?? "")} onChange={(event) => update("introduction", event.target.value)} /></label>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Durée (minutes)</span><input type="number" min={1} value={Number(parameters.duration_minutes ?? 180)} onChange={(event) => update("duration_minutes", Math.max(1, Number(event.target.value) || 180))} /></label>
    <ToggleRow label="Autoriser les révisions après rétroaction" checked={Boolean(parameters.allow_revision ?? true)} onChange={(value) => update("allow_revision", value)} help="L'étudiant peut corriger sa copie et la soumettre à nouveau avant validation finale." />
    <ToggleRow label="Questions adaptatives en fin de labo" checked={Boolean(parameters.adaptive_questions_enabled ?? true)} onChange={(value) => update("adaptive_questions_enabled", value)} help="L'IA peut ajouter des questions ciblées selon les critères et les lacunes détectées." />
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Nombre maximal de questions</span><input type="number" min={0} max={10} value={Number(parameters.max_adaptive_questions ?? 2)} onChange={(event) => update("max_adaptive_questions", Math.max(0, Number(event.target.value) || 0))} /></label>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Critères d'évaluation (JSON)</span><textarea rows={8} value={criteria} onChange={(event) => parseJson("criteria", event.target.value)} /></label>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Sections et champs (JSON)</span><textarea rows={12} value={sections} onChange={(event) => parseJson("sections", event.target.value)} /></label>
    {jsonError && <p className={styles.nodeInspectorErrorText}>{jsonError}</p>}
  </div>;
}
