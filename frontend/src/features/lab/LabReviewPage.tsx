import { useState } from "react";
import { CheckCircle2, ClipboardCheck, ExternalLink, MessageSquareText } from "lucide-react";
import { demoLabActivity } from "./demoData";
import { loadAssessment, loadLabAttempt, saveLabAttempt } from "./storage";
import "./lab.css";

export default function LabReviewPage() {
  const [attempt, setAttempt] = useState(() => loadLabAttempt(demoLabActivity.id));
  const assessment = loadAssessment(demoLabActivity.id);
  const [feedback, setFeedback] = useState("La démarche est claire. Ajoutez une justification plus précise de la source d’erreur avant publication.");
  const [validated, setValidated] = useState(attempt.status === "validated");
  const score = assessment?.score ?? 0;

  const validate = () => {
    const next = { ...attempt, status: "validated" as const, validatedScore: score, feedback: [...attempt.feedback, { id: `teacher-${Date.now()}`, author: "Enseignant" as const, message: feedback, createdAt: new Date().toISOString() }] };
    setAttempt(next); saveLabAttempt(next); setValidated(true);
  };

  return <main className="lab-shell"><header className="lab-topbar"><div><span className="lab-eyebrow">Correction enseignant · {demoLabActivity.courseName}</span><h1>Copies à valider</h1></div><span className="lab-status">{validated ? "Validée" : "Validation requise"}</span></header><div className="lab-review-grid"><section className="lab-document"><div className="lab-section-heading"><div><span className="lab-kicker">Tentative {attempt.id}</span><h2>Dosage acido-basique</h2><p>Soumise le {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString("fr-CA") : "—"}</p></div><div className="lab-score"><strong>{score}<small>/100</small></strong><span>proposition IA</span></div></div>{demoLabActivity.sections.map((section) => <div className="lab-review-section" key={section.id}><h3>{section.title}</h3>{section.fields.map((field) => <div className="lab-review-answer" key={field.id}><strong>{field.label}</strong><p>{attempt.responses[field.id] || "Aucune réponse"}</p>{attempt.attachments.filter((image) => image.fieldId === field.id).map((image) => <img key={image.id} src={image.dataUrl} alt={image.name} />)}</div>)}</div>)}</section><aside className="lab-feedback"><div className="lab-feedback__heading"><ClipboardCheck size={17} /><div><strong>Validation finale</strong><span>La note sera publiée dans Moodle après confirmation.</span></div></div><div className="lab-review-summary"><CheckCircle2 size={18} /><p><strong>{score}/100 proposé</strong><br />L’IA a évalué {demoLabActivity.criteria.length} critères.</p></div><label className="lab-review-label"><MessageSquareText size={16} /> Rétroaction à l’étudiant<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} disabled={validated} rows={7} /></label><button className="lab-button lab-button--primary" onClick={validate} disabled={validated}>{validated ? <><CheckCircle2 size={17} /> Note validée</> : <><ExternalLink size={17} /> Valider et publier dans Moodle</>}</button></aside></div></main>;
}
