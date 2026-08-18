import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, ExternalLink, Plus, RotateCcw, Send, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import "./lab.css";
import "./lab-buttons.css";
import "./lab-admin.css";

type Lab = { id: number; slug: string; title: string; description?: string; source_path?: string; version?: number; field_count: number; attempt_count: number };
type Version = { id: number; version: number; content_hash: string; created_at: string; field_count: number };
type Validation = { approved: boolean; comment?: string; teacher_name?: string };
type Attempt = { id: string; status: string; revision: number; updated_at: string; version: number; answers: Record<string, unknown>; teacher_validations: Record<string, Validation>; teacher_validation_fields: { id: string; label: string; section?: string }[]; user: { email: string; display_name?: string }; score?: number; feedback?: string };

export default function LabReviewPage() {
  const { token } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [slug, setSlug] = useState(""), [attempts, setAttempts] = useState<Attempt[]>([]), [versions, setVersions] = useState<Version[]>([]);
  const [selectedId, setSelectedId] = useState<string>(), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [newSlug, setNewSlug] = useState(""), [description, setDescription] = useState("");
  const [upload, setUpload] = useState<File | null>(null), [replacement, setReplacement] = useState<File | null>(null);
  const [score, setScore] = useState("100"), [feedback, setFeedback] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const loadCatalog = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/labs/admin/catalog", { headers });
    if (!response.ok) throw new Error((await response.json()).detail ?? "Catalogue inaccessible");
    const result = await response.json() as { labs: Lab[] };
    setLabs(result.labs); setSlug((current) => current || result.labs[0]?.slug || "");
  }, [token]);

  const loadLab = useCallback(async () => {
    if (!token || !slug) { setAttempts([]); setVersions([]); return; }
    const [a, v] = await Promise.all([fetch(`/api/labs/admin/${slug}/attempts`, { headers }), fetch(`/api/labs/admin/${slug}/versions`, { headers })]);
    if (!a.ok || !v.ok) throw new Error("Chargement du laboratoire impossible");
    const next = await a.json() as Attempt[]; setAttempts(next); setVersions(await v.json() as Version[]); setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id);
  }, [token, slug]);

  const refresh = useCallback(async () => { setError(""); try { await loadCatalog(); await loadLab(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }, [loadCatalog, loadLab]);
  useEffect(() => { void loadCatalog().catch((reason) => setError(String(reason))); }, [loadCatalog]);
  useEffect(() => { void loadLab().catch((reason) => setError(String(reason))); }, [loadLab]);
  const selected = attempts.find((attempt) => attempt.id === selectedId), currentLab = labs.find((lab) => lab.slug === slug);

  const create = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    if (!upload) { setError("Choisissez un fichier Markdown."); return; }
    const form = new FormData(); form.append("slug", newSlug); form.append("description", description); form.append("file", upload);
    const response = await fetch("/api/labs/admin/upload", { method: "POST", headers, body: form });
    if (!response.ok) { setError((await response.json()).detail ?? "Création impossible"); return; }
    const result = await response.json(); setNewSlug(""); setDescription(""); setUpload(null); setSlug(result.slug); setMessage(`${result.title} a été créé et publié.`); await loadCatalog();
  };
  const publishVersion = async () => {
    if (!replacement) { setError("Choisissez le nouveau fichier Markdown."); return; }
    setError(""); setMessage("");
    const form = new FormData(); form.append("file", replacement);
    const response = await fetch(`/api/labs/admin/${slug}/upload`, { method: "POST", headers, body: form });
    if (!response.ok) { setError((await response.json()).detail ?? "Publication impossible"); return; }
    const result = await response.json(); setReplacement(null); setMessage(`Nouvelle version publiée — version ${result.version}.`); await refresh();
  };
  const action = async (path: string, body?: unknown) => {
    const response = await fetch(path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) { setError((await response.json()).detail ?? "Opération impossible"); return; }
    setMessage("Modification enregistrée."); await loadLab();
  };

  return <main className="lab-shell"><header className="lab-topbar"><div><span className="lab-eyebrow">Laboratoires déterministes</span><h1>Gestion des laboratoires</h1></div>{slug && <div className="lab-admin-actions"><Link className="lab-button" to={`/lab/${slug}`}><ExternalLink size={17} /> Prévisualiser</Link></div>}</header>
    {message && <div className="lab-submitted">{message}</div>}{error && <div className="lab-inline-error">{error}</div>}
    <section className="lab-create-card"><h2><Plus size={20} /> Nouveau laboratoire</h2><form onSubmit={create} className="lab-create-form"><label className="lab-upload-label">Fichier Markdown<input required type="file" accept=".md,text/markdown,text/plain" onChange={(event) => setUpload(event.target.files?.[0] ?? null)} /><small>{upload?.name ?? "Maximum 2 Mo, UTF-8"}</small></label><label>Slug<input required pattern="[a-z][a-z0-9-]+" placeholder="laboratoire-2" value={newSlug} onChange={(event) => setNewSlug(event.target.value.toLowerCase())} /></label><label>Description<input placeholder="243-1J5-LI — Laboratoire 2" value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="lab-button lab-button--primary" type="submit"><Upload size={17} /> Téléverser et publier</button></form></section>
    <nav className="lab-catalog-tabs" aria-label="Laboratoires">{labs.map((lab) => <button key={lab.slug} className={lab.slug === slug ? "is-selected" : ""} onClick={() => setSlug(lab.slug)}><strong>{lab.title}</strong><span>v{lab.version ?? "—"} · {lab.field_count} champs · {lab.attempt_count} tentative(s)</span></button>)}</nav>
    {currentLab && <section className="lab-version-upload"><div><strong>Publier une nouvelle version</strong><span>Les réponses compatibles sont conservées grâce aux identifiants des champs.</span></div><label className="lab-button"><Upload size={17} /> Choisir le Markdown<input type="file" accept=".md,text/markdown,text/plain" onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} /></label><span className="lab-version-upload__file">{replacement?.name}</span><button className="lab-button lab-button--primary" disabled={!replacement} onClick={publishVersion}>Publier</button></section>}
    {slug && <div className="lab-review-grid"><section className="lab-document"><div className="lab-section-heading"><div><span className="lab-kicker">{versions.length} version(s)</span><h2>Copies étudiantes</h2><p>Version publiée : {versions[0]?.version ?? "—"} · {versions[0]?.field_count ?? 0} champs</p></div></div>{!attempts.length && <p>Aucune tentative pour le moment.</p>}{attempts.map((attempt) => <button key={attempt.id} className={`lab-attempt-row ${selectedId === attempt.id ? "is-selected" : ""}`} onClick={() => { setSelectedId(attempt.id); setFeedback(attempt.feedback ?? ""); setScore(String(attempt.score ?? 100)); }}><strong>{attempt.user.display_name || attempt.user.email}</strong><span>Version {attempt.version} · {attempt.status} · {new Date(attempt.updated_at).toLocaleString("fr-CA")}</span></button>)}{selected && <div className="lab-review-section"><h3>Réponses</h3>{Object.entries(selected.answers).map(([id, value]) => <div className="lab-review-answer" key={id}><strong>{id}</strong><p>{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</p></div>)}</div>}</section>
      <aside className="lab-feedback"><div className="lab-feedback__heading"><ClipboardCheck size={17} /><div><strong>Validation et évaluation</strong><span>{selected?.user.email ?? "Sélectionnez une copie"}</span></div></div>{selected && <>{selected.teacher_validation_fields.length > 0 && <div className="lab-validation-list"><h3>Validations enseignantes</h3>{selected.teacher_validation_fields.map((field) => { const validation = selected.teacher_validations[field.id]; return <div className={`lab-review-summary ${validation?.approved ? "is-approved" : ""}`} key={field.id}><CheckCircle2 size={18} /><div>{field.section && <span className="lab-validation-section">{field.section}</span>}<p><strong>{field.label}</strong><br />{validation?.approved ? `Validée par ${validation.teacher_name}` : "En attente de validation"}</p><button className="lab-button" onClick={() => action(`/api/labs/admin/attempts/${selected.id}/teacher-validation`, { field_id: field.id, approved: !validation?.approved, comment: validation?.approved ? "Validation retirée" : "Étape vérifiée" })}>{validation?.approved ? "Retirer la validation" : "Valider cette étape"}</button></div></div>})}</div>} {selected.status !== "in_progress" && <button className="lab-button" onClick={() => action(`/api/labs/admin/attempts/${selected.id}/reopen`)}><RotateCcw size={17} /> Permettre à l’étudiant de modifier sa copie</button>}<label className="lab-review-label">Note / 100<input type="number" min="0" max="100" value={score} onChange={(event) => setScore(event.target.value)} /></label><label className="lab-review-label">Rétroaction<textarea rows={6} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></label><button className="lab-button lab-button--primary" onClick={() => action(`/api/labs/admin/attempts/${selected.id}/grade`, { score: Number(score), maximum: 100, feedback, publish_to_moodle: false })}><ClipboardCheck size={17} /> Enregistrer l’évaluation</button><button className="lab-button" onClick={() => action(`/api/labs/admin/attempts/${selected.id}/grade`, { score: Number(score), maximum: 100, feedback, publish_to_moodle: true })}><Send size={17} /> Publier dans Moodle</button></>}</aside></div>}
  </main>;
}
