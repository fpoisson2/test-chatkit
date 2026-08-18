import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, Cloud, CloudOff, Download, FileCheck2, ImagePlus, Save, Trash2 } from "lucide-react";
import { useAuth } from "../../auth";
import "./lab.css";
import "./lab-buttons.css";
import "./lab-content.css";

type Option = { id: string; label: string; input_type?: "text" | "number" | "select" | "color" | "readonly"; unit?: string; options?: string[] };
type Field = {
  id: string; type: string; label: string; required?: boolean; unit?: string;
  rows?: number; options?: Option[]; columns?: Option[]; min?: number;
  max?: number; step?: number | "any"; visible_columns?: string[];
};
type Block = { type: "markdown"; content: string } | { type: "field"; field: Field };
type TeacherValidation = { approved: boolean; comment?: string; teacher_name?: string; validated_at?: string };
type Attempt = { id: string; status: string; revision: number; answers: Record<string, unknown>; updated_at: string; teacher_validations?: Record<string, TeacherValidation>; feedback?: string; score?: number };
type LaunchPayload = { activity: { slug: string; title: string; definition: { blocks: Block[]; fields: Field[] } }; attempt: Attempt };

const pendingKey = (slug: string) => `edxo.lab.pending.${slug}`;

export default function LabPage() {
  const { activityId = "laboratoire-1" } = useParams<{ activityId: string }>();
  const { token } = useAuth();
  const [data, setData] = useState<LaunchPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline" | "error">("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/labs/${encodeURIComponent(activityId)}/attempt`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).detail ?? "Chargement impossible");
      return response.json() as Promise<LaunchPayload>;
    }).then((payload) => {
      setData(payload);
      setLastSavedAt(new Date(payload.attempt.updated_at));
      const pending = localStorage.getItem(pendingKey(activityId));
      setAnswers(pending ? { ...payload.attempt.answers, ...JSON.parse(pending) } : payload.attempt.answers);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [activityId, token]);

  const save = useCallback(async () => {
    if (!data || !token || !dirty.current || data.attempt.status !== "in_progress") return;
    setSaveState("saving");
    localStorage.setItem(pendingKey(activityId), JSON.stringify(answers));
    try {
      const response = await fetch(`/api/labs/attempts/${data.attempt.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ answers, revision: data.attempt.revision }),
      });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Sauvegarde impossible");
      const attempt = await response.json() as Attempt;
      setData((current) => current && ({ ...current, attempt }));
      localStorage.removeItem(pendingKey(activityId));
      dirty.current = false;
      setSaveState("saved");
      setLastSavedAt(new Date(attempt.updated_at));
    } catch (reason) {
      setSaveState(navigator.onLine ? "error" : "offline");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [activityId, answers, data, token]);

  useEffect(() => {
    const timer = window.setTimeout(save, 700);
    return () => window.clearTimeout(timer);
  }, [answers, save]);
  useEffect(() => {
    const retry = () => { if (dirty.current) void save(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [save]);

  const update = (id: string, value: unknown) => {
    dirty.current = true;
    setSaveState("saving");
    setError(null);
    setAnswers((current) => ({ ...current, [id]: value }));
  };

  const submit = async () => {
    if (!data || !token || data.attempt.status !== "in_progress") return;
    setSaveState("saving");
    const response = await fetch(`/api/labs/attempts/${data.attempt.id}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ answers, revision: data.attempt.revision }),
    });
    if (!response.ok) {
      setError((await response.json()).detail ?? "Remise impossible");
      setSaveState("error");
      return;
    }
    const attempt = await response.json() as Attempt;
    setData({ ...data, attempt });
    localStorage.removeItem(pendingKey(activityId));
    dirty.current = false;
    setSaveState("saved");
    setLastSavedAt(new Date(attempt.updated_at));
  };

  const downloadWord = async () => {
    if (!data || !token) return;
    setExporting(true); setError(null);
    try {
      const response = await fetch(`/api/labs/attempts/${data.attempt.id}/export.docx`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Création du document impossible");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${data.activity.slug}-copie.docx`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setExporting(false); }
  };

  const completion = useMemo(() => {
    if (!data) return 0;
    const required = data.activity.definition.fields.filter((field) => field.required && field.type !== "teacher_validation");
    const filled = required.filter((field) => {
      const value = answers[field.id];
      return value === true || (typeof value === "string" && value.trim() !== "") || (value && typeof value === "object" && Object.keys(value).length > 0) || typeof value === "number";
    });
    return required.length ? Math.round(filled.length / required.length * 100) : 100;
  }, [answers, data]);

  if (error && !data) return <main className="lab-loading lab-error">{error}</main>;
  if (!data) return <main className="lab-loading">Chargement du laboratoire…</main>;
  const locked = data.attempt.status !== "in_progress";

  return <main className="lab-form-shell">
    <header className="lab-form-header">
      <div><span className="lab-kicker">Laboratoire interactif</span><h1>{data.activity.title}</h1></div>
      <div className={`lab-save-state lab-save-state--${saveState}`}>
        {saveState === "offline" ? <CloudOff size={18} /> : saveState === "saved" ? <Cloud size={18} /> : <Save size={18} />}
        {saveState === "saved" ? "Progression enregistrée" : saveState === "saving" ? "Enregistrement…" : saveState === "offline" ? "Hors ligne — sauvegarde locale" : "Sauvegarde à reprendre"}
      </div>
    </header>
    <div className="lab-form-progress"><span style={{ width: `${completion}%` }} /><strong>{completion}%</strong></div>
    {saveState === "saved" && <div className="lab-save-confirmation" role="status"><CheckCircle2 size={16} /><strong>Enregistré</strong>{lastSavedAt && <span>· {lastSavedAt.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}</div>}
    {locked && <div className="lab-submitted"><CheckCircle2 /> Tentative remise — les réponses sont verrouillées.</div>}
    {error && <div className="lab-inline-error">{error}</div>}
    <article className="lab-form-document">
      {data.activity.definition.blocks.map((block, index) => block.type === "markdown"
        ? <ReactMarkdown key={index} remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
        : <FieldControl key={block.field.id} field={block.field} value={answers[block.field.id]} disabled={locked} onChange={update} attemptId={data.attempt.id} teacherValidation={data.attempt.teacher_validations?.[block.field.id]} />)}
      <footer className="lab-submit-row">
        <button className="lab-button" disabled={exporting} onClick={downloadWord}>
          <Download size={18} /> {exporting ? "Création du document…" : "Télécharger ma copie Word"}
        </button>
        <button className="lab-button lab-button--primary" disabled={locked || saveState === "saving"} onClick={submit}>
          <FileCheck2 size={18} /> Remettre définitivement
        </button>
      </footer>
    </article>
  </main>;
}

function FieldControl({ field, value, disabled, onChange, attemptId, teacherValidation }: { field: Field; value: unknown; disabled: boolean; onChange: (id: string, value: unknown) => void; attemptId: string; teacherValidation?: TeacherValidation }) {
  const label = <label htmlFor={`lab-${field.id}`}>{field.label}{field.unit ? ` (${field.unit})` : ""}{field.required && <em> *</em>}</label>;
  if (field.type === "table" || field.type === "matrix") {
    const cells = (value && typeof value === "object" ? value : {}) as Record<string, string>;
    const columns = field.columns?.filter((column) => !field.visible_columns?.length || field.visible_columns.includes(column.id)) ?? [];
    return <section className="lab-control lab-grid-control">{label}<div className="lab-table-wrap"><table><thead><tr><th />{columns.map((column) => <th key={column.id}>{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}</tr></thead><tbody>{field.rows?.map((row) => <tr key={row.id}><th>{row.label}</th>{columns.map((column) => { const key = `${row.id}.${column.id}`; const cellValue = cells[key] ?? ""; return <td key={key}>{column.input_type === "select" || column.input_type === "color" ? <select aria-label={`${row.label} — ${column.label}`} value={cellValue} disabled={disabled} onChange={(event) => onChange(field.id, { ...cells, [key]: event.target.value })}><option value="">Sélectionner…</option>{column.input_type === "color" ? ["noir", "brun", "rouge", "orange", "jaune", "vert", "bleu", "violet", "gris", "blanc", "or", "argent"].map((option) => <option key={option} value={option}>{option}</option>) : column.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={column.input_type === "number" ? "number" : "text"} step={column.input_type === "number" ? "any" : undefined} aria-label={`${row.label} — ${column.label}`} value={cellValue} disabled={disabled || column.input_type === "readonly"} onChange={(event) => onChange(field.id, { ...cells, [key]: event.target.value })} />}</td>; })}</tr>)}</tbody></table></div></section>;
  }
  if (field.type === "teacher_validation") return <section className={`lab-control lab-teacher-validation ${teacherValidation?.approved ? "is-approved" : ""}`}><strong>{field.label}</strong>{teacherValidation?.approved ? <p><CheckCircle2 size={18} /> Validée par {teacherValidation.teacher_name ?? "la personne enseignante"}{teacherValidation.comment ? ` — ${teacherValidation.comment}` : ""}</p> : <p>Validation à effectuer par la personne enseignante.</p>}</section>;
  if (field.type === "image") return <ImageField field={field} value={value} disabled={disabled} onChange={onChange} attemptId={attemptId} />;
  if (field.type === "checkbox") return <section className="lab-control lab-check"><label><input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(field.id, event.target.checked)} /> {field.label}{field.required && <em> *</em>}</label></section>;
  if (field.type === "select" || field.type === "radio") return <section className="lab-control">{label}<select id={`lab-${field.id}`} value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(field.id, event.target.value)}><option value="">Sélectionner…</option>{field.options?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></section>;
  if (field.type === "textarea") return <section className="lab-control">{label}<textarea id={`lab-${field.id}`} rows={field.rows ?? 3} value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(field.id, event.target.value)} /></section>;
  return <section className="lab-control">{label}<div className="lab-input-unit"><input id={`lab-${field.id}`} type={field.type === "number" ? "number" : "text"} step={field.step ?? "any"} value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(field.id, event.target.value)} />{field.unit && <span>{field.unit}</span>}</div></section>;
}

function ImageField({ field, value, disabled, onChange, attemptId }: { field: Field; value: unknown; disabled: boolean; onChange: (id: string, value: unknown) => void; attemptId: string }) {
  const { token } = useAuth();
  const metadata = value && typeof value === "object" ? value as { id?: string; name?: string } : null;
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file || !token || !attemptId) return;
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/labs/attempts/${encodeURIComponent(attemptId)}/images/${encodeURIComponent(field.id)}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Téléversement impossible");
      const result = await response.json() as { image: Record<string, unknown> };
      onChange(field.id, result.image);
    } finally { setUploading(false); }
  };
  return <section className="lab-control lab-image-control"><label>{field.label}{field.required && <em> *</em>}</label>{metadata?.id && <AuthImage src={`/api/labs/attempts/${attemptId}/images/${metadata.id}`} token={token} alt={metadata.name ?? field.label} />}<div className="lab-image-actions"><label className="lab-button"><ImagePlus size={18} /> {uploading ? "Téléversement…" : metadata ? "Remplacer l’image" : "Ajouter une image"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={disabled || uploading} onChange={(event) => void upload(event.target.files?.[0])} /></label>{metadata && !disabled && <button type="button" className="lab-button" onClick={() => onChange(field.id, null)}><Trash2 size={17} /> Retirer</button>}</div><small>JPEG, PNG, WebP ou GIF · maximum 10 Mo</small></section>;
}

function AuthImage({ src, token, alt }: { src: string; token?: string | null; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!token) return;
    let active = true, objectUrl = "";
    fetch(src, { headers: { Authorization: `Bearer ${token}` } }).then((response) => { if (!response.ok) throw new Error(); return response.blob(); }).then((blob) => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, token]);
  return url ? <img className="lab-uploaded-image" src={url} alt={alt} /> : <span className="lab-image-loading">Chargement de l’image…</span>;
}
