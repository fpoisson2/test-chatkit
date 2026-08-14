import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AgentParameters } from "../../../../types";
import styles from "../NodeInspector.module.css";
import { ToggleRow } from "../components/ToggleRow";
import "../../../../lab/lab.css";
import { LabDocumentEditor } from "./LabDocumentEditor";

type LabCriterion = { id: string; label: string; description?: string; weight: number; max_points: number };
type LabField = { id: string; type: string; label: string; prompt: string; required?: boolean; criterion_id?: string };
type LabSection = { id: string; title: string; description?: string; fields: LabField[] };
type Props = { parameters: AgentParameters; onParametersChange: (parameters: AgentParameters) => void };
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function LabInspectorSection({ parameters, onParametersChange }: Props) {
  const [isDocumentEditorOpen, setDocumentEditorOpen] = useState(false);
  const criteria = useMemo<LabCriterion[]>(() => Array.isArray(parameters.criteria) ? parameters.criteria as LabCriterion[] : [], [parameters.criteria]);
  const sections = useMemo<LabSection[]>(() => Array.isArray(parameters.sections) ? parameters.sections as LabSection[] : [], [parameters.sections]);
  const update = (patch: Record<string, unknown>) => onParametersChange({ ...parameters, ...patch });
  const updateSection = (sectionId: string, patch: Partial<LabSection>) => update({ sections: sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section) });
  const updateField = (sectionId: string, fieldId: string, patch: Partial<LabField>) => update({ sections: sections.map((section) => section.id === sectionId ? { ...section, fields: section.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field) } : section) });
  const addSection = () => update({ sections: [...sections, { id: makeId("section"), title: `Section ${sections.length + 1}`, description: "", fields: [] }] });
  const addCriterion = () => update({ criteria: [...criteria, { id: makeId("criterion"), label: `Critère ${criteria.length + 1}`, description: "", weight: 0, max_points: 0 }] });
  const addField = (section: LabSection) => updateSection(section.id, { fields: [...section.fields, { id: makeId("field"), type: "textarea", label: "Nouvelle réponse", prompt: "", required: false, criterion_id: criteria[0]?.id }] });
  const updateCriterion = (criterionId: string, patch: Partial<LabCriterion>) => update({ criteria: criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, ...patch } : criterion) });
  const removeCriterion = (criterionId: string) => update({ criteria: criteria.filter((criterion) => criterion.id !== criterionId), sections: sections.map((section) => ({ ...section, fields: section.fields.map((field) => field.criterion_id === criterionId ? { ...field, criterion_id: undefined } : field) })) });

  return <div className={styles.nodeInspectorPanel}>
    <strong className={styles.nodeInspectorSectionTitle}>Créer le laboratoire</strong>
    <p className={styles.nodeInspectorHintTextTight}>Construisez le document par sections. Les champs seront éditables directement par l’étudiant dans le document du chat.</p>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Titre</span><input value={String(parameters.title ?? "")} onChange={(event) => update({ title: event.target.value })} /></label>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Consignes générales</span><textarea rows={3} value={String(parameters.introduction ?? "")} onChange={(event) => update({ introduction: event.target.value })} /></label>
    <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Durée (minutes)</span><input type="number" min={1} value={Number(parameters.duration_minutes ?? 180)} onChange={(event) => update({ duration_minutes: Math.max(1, Number(event.target.value) || 180) })} /></label>
    <ToggleRow label="Autoriser les révisions" checked={Boolean(parameters.allow_revision ?? true)} onChange={(value) => update({ allow_revision: value })} help="L'étudiant pourra modifier sa copie après rétroaction." />
    <ToggleRow label="Questions adaptatives" checked={Boolean(parameters.adaptive_questions_enabled ?? true)} onChange={(value) => update({ adaptive_questions_enabled: value })} help="L'IA pourra ajouter des questions selon les lacunes observées." />
    {Boolean(parameters.adaptive_questions_enabled ?? true) && <label className={styles.nodeInspectorField}><span className={styles.nodeInspectorLabel}>Maximum de questions</span><input type="number" min={0} max={10} value={Number(parameters.max_adaptive_questions ?? 2)} onChange={(event) => update({ max_adaptive_questions: Math.max(0, Number(event.target.value) || 0) })} /></label>}
    <div className="lab-builder__document-card"><div><strong>Document étudiant</strong><p>Composez la mise en page du laboratoire dans un éditeur visuel.</p></div><button type="button" onClick={() => setDocumentEditorOpen(true)}><TypeIcon /> Ouvrir l’éditeur</button></div>

    <div className="lab-builder__panel"><div className="lab-builder__heading"><strong>Sections du document</strong><button type="button" onClick={addSection}><Plus size={14} /> Ajouter</button></div>{sections.map((section) => <div className="lab-builder__section" key={section.id}><div className="lab-builder__row"><input aria-label="Titre de section" value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })} /><button type="button" onClick={() => update({ sections: sections.filter((item) => item.id !== section.id) })} aria-label="Supprimer la section"><Trash2 size={14} /></button></div><textarea rows={2} placeholder="Description de la section" value={section.description ?? ""} onChange={(event) => updateSection(section.id, { description: event.target.value })} />{section.fields.map((field) => <div className="lab-builder__field" key={field.id}><div className="lab-builder__row"><input aria-label="Nom du champ" value={field.label} onChange={(event) => updateField(section.id, field.id, { label: event.target.value })} /><select aria-label="Type de champ" value={field.type} onChange={(event) => updateField(section.id, field.id, { type: event.target.value })}><option value="textarea">Texte riche</option><option value="text">Texte court</option><option value="number">Nombre</option><option value="select">Choix</option><option value="image">Image</option></select><button type="button" onClick={() => updateSection(section.id, { fields: section.fields.filter((item) => item.id !== field.id) })} aria-label="Supprimer le champ"><Trash2 size={14} /></button></div><input aria-label="Consigne du champ" placeholder="Consigne affichée à l’étudiant" value={field.prompt} onChange={(event) => updateField(section.id, field.id, { prompt: event.target.value })} /><select aria-label="Critère du champ" value={field.criterion_id ?? ""} onChange={(event) => updateField(section.id, field.id, { criterion_id: event.target.value || undefined })}><option value="">Sans critère</option>{criteria.map((criterion) => <option key={criterion.id} value={criterion.id}>{criterion.label}</option>)}</select></div>)}<button type="button" className="lab-builder__add-field" onClick={() => addField(section)}><Plus size={14} /> Ajouter un champ</button></div>)}</div>

    <div className="lab-builder__panel"><div className="lab-builder__heading"><strong>Critères de correction</strong><button type="button" onClick={addCriterion}><Plus size={14} /> Ajouter</button></div>{criteria.map((criterion) => <div className="lab-builder__criterion" key={criterion.id}><div className="lab-builder__row"><input aria-label="Nom du critère" value={criterion.label} onChange={(event) => updateCriterion(criterion.id, { label: event.target.value })} /><button type="button" onClick={() => removeCriterion(criterion.id)} aria-label="Supprimer le critère"><Trash2 size={14} /></button></div><input aria-label="Description du critère" placeholder="Ce qui sera évalué" value={criterion.description ?? ""} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /><div className="lab-builder__row"><label>Points <input type="number" min={0} value={criterion.max_points} onChange={(event) => updateCriterion(criterion.id, { max_points: Math.max(0, Number(event.target.value) || 0) })} /></label><label>Pondération <input type="number" min={0} max={100} value={criterion.weight} onChange={(event) => updateCriterion(criterion.id, { weight: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label></div></div>)}</div>
    {isDocumentEditorOpen && <LabDocumentEditor parameters={parameters} onSave={(document_html) => update({ document_html })} onClose={() => setDocumentEditorOpen(false)} />}
  </div>;
}

function TypeIcon() { return <span aria-hidden="true">✦</span>; }
