import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../auth";
import { Check, ChevronRight, Clock3, FileCheck2, ImagePlus, RotateCcw, Save, Sparkles, Upload, X } from "lucide-react";
import { demoLabActivity } from "./demoData";
import { loadAssessment, loadLabActivity, loadLabAttempt, saveAssessment, saveLabAttempt } from "./storage";
import type { LabAssessment, LabAttempt, LabAttachment, LabField } from "./types";
import "./lab.css";

const formatTime = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function assess(attempt: LabAttempt, activity = demoLabActivity): LabAssessment {
  const filled = Object.values(attempt.responses).filter((value) => value.trim()).length;
  const total = activity.sections.flatMap((section) => section.fields).length;
  const score = Math.round((filled / total) * 100);
  const byCriterion = Object.fromEntries(activity.criteria.map((criterion) => [criterion.id, {
    score: Math.round((score / 100) * criterion.maxPoints),
    feedback: score > 70 ? "Les éléments attendus sont présents. Précisez encore votre justification scientifique." : "Ajoutez des données concrètes et reliez-les explicitement à ce critère.",
  }]));
  return { score, maxScore: 100, summary: "Proposition générée à partir des critères du laboratoire. Elle doit être validée par l’enseignant.", byCriterion, adaptiveQuestions: score < 80 ? ["Quelle donnée supplémentaire renforcerait votre conclusion?", "Comment vérifieriez-vous la principale source d’erreur?"] : [] };
}

export default function LabPage() {
  const { activityId = "chimie-acide-base" } = useParams<{ activityId: string }>();
  const { token } = useAuth();
  const [activity, setActivity] = useState(() => ({ ...loadLabActivity(activityId), id: activityId }));
  const [attempt, setAttempt] = useState(() => loadLabAttempt(activity.id));
  const [assessment, setAssessment] = useState<LabAssessment | null>(() => loadAssessment(activity.id));
  const [remaining, setRemaining] = useState(() => Math.max(0, activity.durationSeconds - Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000)));
  const [saved, setSaved] = useState(true);
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    if (!token || activityId === "chimie-acide-base") return;
    fetch(`/api/labs/workflow/${encodeURIComponent(activityId)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((remote) => { if (remote) setActivity(remote); })
      .catch(() => {});
  }, [activityId, token]);

  const locked = attempt.status === "validated" || attempt.status === "expired";
  const canEdit = !locked;

  useEffect(() => {
    if (!canEdit) return;
    const timer = window.setInterval(() => setRemaining(Math.max(0, activity.durationSeconds - Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [activity.durationSeconds, attempt.startedAt, canEdit]);

  useEffect(() => {
    if (remaining === 0 && canEdit) {
      const expired = { ...attempt, status: "expired" as const };
      setAttempt(expired); saveLabAttempt(expired);
    }
  }, [remaining, canEdit, attempt]);

  const update = useCallback((fieldId: string, value: string) => {
    setAttempt((current) => { const next = { ...current, responses: { ...current.responses, [fieldId]: value } }; saveLabAttempt(next); return next; });
    setSaved(false);
    window.setTimeout(() => setSaved(true), 450);
  }, []);

  const addImage = useCallback((field: LabField, file: File) => {
    if (!file.type.startsWith("image/") || file.size > 5_000_000) return;
    const reader = new FileReader();
    reader.onload = () => setAttempt((current) => { const attachment: LabAttachment = { id: `${field.id}-${Date.now()}`, fieldId: field.id, name: file.name, type: file.type, dataUrl: String(reader.result) }; const next = { ...current, attachments: [...current.attachments.filter((item) => item.fieldId !== field.id), attachment] }; saveLabAttempt(next); return next; });
    reader.readAsDataURL(file);
  }, []);

  const removeImage = (id: string) => setAttempt((current) => { const next = { ...current, attachments: current.attachments.filter((item) => item.id !== id) }; saveLabAttempt(next); return next; });
  const submit = () => { const next = { ...attempt, status: "submitted" as const, submittedAt: new Date().toISOString() }; const result = assess(next, activity); setAttempt(next); setAssessment(result); saveLabAttempt(next); saveAssessment(activity.id, result); };
  const revise = () => { const next = { ...attempt, status: "revision_requested" as const, revisionCount: attempt.revisionCount + 1 }; setAttempt(next); saveLabAttempt(next); };
  const requestTeacherReview = () => { const next = { ...attempt, status: "submitted" as const }; setAttempt(next); saveLabAttempt(next); };
  const currentSection = activity.sections[activeSection];
  const completion = useMemo(() => { const fields = activity.sections.flatMap((section) => section.fields); return Math.round((fields.filter((field) => attempt.responses[field.id]?.trim() || attempt.attachments.some((item) => item.fieldId === field.id)).length / fields.length) * 100); }, [activity.sections, attempt]);

  return <main className="lab-shell">
    <header className="lab-topbar"><div><span className="lab-eyebrow">{activity.courseName}</span><h1>{activity.title}</h1></div><div className={`lab-timer ${remaining < 900 ? "lab-timer--urgent" : ""}`}><Clock3 size={18} /><span>{formatTime(remaining)}</span><small>restant</small></div></header>
    <div className="lab-progress"><div><span>Progression du document</span><strong>{completion}%</strong></div><div className="lab-progress__track"><span style={{ width: `${completion}%` }} /></div><span className="lab-save"><Save size={14} /> {saved ? "Enregistré" : "Enregistrement…"}</span></div>
    <div className="lab-layout">
      <aside className="lab-outline"><p className="lab-outline__label">Votre démarche</p>{activity.sections.map((section, index) => <button key={section.id} className={index === activeSection ? "is-active" : ""} onClick={() => setActiveSection(index)}><span>{String(index + 1).padStart(2, "0")}</span>{section.title.replace(/^\d+\. /, "")}{index < activeSection && <Check size={15} />}</button>)}<div className="lab-note"><Sparkles size={17} /><p><strong>Coéquipier IA</strong><br />Vous pouvez revoir vos réponses après chaque rétroaction.</p></div></aside>
      <section className="lab-document"><div className="lab-intro"><span className="lab-kicker">Document de laboratoire</span><p>{activity.introduction}</p></div><div className="lab-section-heading"><div><span className="lab-kicker">Section {activeSection + 1} sur {activity.sections.length}</span><h2>{currentSection.title.replace(/^\d+\. /, "")}</h2><p>{currentSection.description}</p></div><span className="lab-status">{attempt.status === "in_progress" ? "En cours" : attempt.status === "revision_requested" ? "Révision ouverte" : attempt.status}</span></div>{currentSection.fields.map((field) => <Field key={field.id} field={field} value={attempt.responses[field.id] ?? ""} attachment={attempt.attachments.find((item) => item.fieldId === field.id)} disabled={!canEdit} onChange={update} onImage={addImage} onRemoveImage={removeImage} />)}<div className="lab-section-actions">{activeSection > 0 && <button className="lab-button lab-button--quiet" onClick={() => setActiveSection((index) => index - 1)}>Précédent</button>}{activeSection < activity.sections.length - 1 ? <button className="lab-button lab-button--primary" onClick={() => setActiveSection((index) => index + 1)}>Continuer <ChevronRight size={17} /></button> : canEdit && <button className="lab-button lab-button--primary" onClick={submit}><FileCheck2 size={17} /> Soumettre pour correction</button>}</div></section>
      <aside className="lab-feedback"><div className="lab-feedback__heading"><Sparkles size={17} /><div><strong>Rétroaction IA</strong><span>{assessment ? "Proposition disponible" : "Pendant votre travail"}</span></div></div>{assessment ? <><div className="lab-score"><strong>{assessment.score}<small>/100</small></strong><span>proposition IA</span></div><p>{assessment.summary}</p>{activity.criteria.map((criterion) => <div className="lab-criterion" key={criterion.id}><div><strong>{criterion.label}</strong><span>{assessment.byCriterion[criterion.id]?.score}/{criterion.maxPoints}</span></div><p>{assessment.byCriterion[criterion.id]?.feedback}</p></div>)}{assessment.adaptiveQuestions.length > 0 && <div className="lab-questions"><span>Questions suggérées</span>{assessment.adaptiveQuestions.map((question) => <p key={question}>{question}</p>)}</div>}{attempt.status === "submitted" && <button className="lab-button lab-button--outline" onClick={revise}><RotateCcw size={16} /> Corriger mes réponses</button>}{attempt.status === "revision_requested" && <button className="lab-button lab-button--primary" onClick={requestTeacherReview}>Envoyer la révision</button>}</> : <div className="lab-empty-feedback"><Sparkles size={26} /><p>Remplissez le document. Une rétroaction ciblée apparaîtra après votre soumission.</p></div>}</aside>
    </div>
  </main>;
}

function Field({ field, value, attachment, disabled, onChange, onImage, onRemoveImage }: { field: LabField; value: string; attachment?: LabAttachment; disabled: boolean; onChange: (id: string, value: string) => void; onImage: (field: LabField, file: File) => void; onRemoveImage: (id: string) => void }) {
  return <article className="lab-field"><label htmlFor={`field-${field.id}`}><span>{field.label}{field.required && <em>*</em>}</span><small>{field.prompt}</small></label>{field.type === "image" ? <div className="lab-upload">{attachment ? <div className="lab-image-preview"><img src={attachment.dataUrl} alt={attachment.name} /><button type="button" onClick={() => onRemoveImage(attachment.id)} disabled={disabled} aria-label="Supprimer l’image"><X size={16} /></button></div> : <label className="lab-upload__drop"><ImagePlus size={24} /><strong>Ajouter une image</strong><small>PNG, JPG ou WEBP · 5 Mo maximum</small><input type="file" accept="image/*" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(field, file); }} /></label>}</div> : field.type === "select" ? <select id={`field-${field.id}`} value={value} disabled={disabled} onChange={(event) => onChange(field.id, event.target.value)}><option value="">Sélectionner…</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <textarea id={`field-${field.id}`} value={value} disabled={disabled} onChange={(event) => onChange(field.id, event.target.value)} placeholder={field.placeholder} rows={field.type === "number" ? 2 : 5} inputMode={field.type === "number" ? "decimal" : undefined} />}</article>;
}
