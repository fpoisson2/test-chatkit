import { Loader2, Wand2 } from "lucide-react";

export default function FeedbackEditor({ value, onChange, onGenerate, busy = false }: { value: string; onChange: (value: string) => void; onGenerate: () => void; busy?: boolean }) {
  return <div className="lab-feedback-editor"><label>Rétroaction<div className="lab-feedback-editor__field"><textarea rows={6} value={value} onChange={event => onChange(event.target.value)} /><button type="button" className="lab-feedback-editor__wand" onClick={onGenerate} disabled={busy} title={busy ? "Génération en cours…" : "Générer avec gpt-5.6-luna"} aria-label={busy ? "Génération en cours…" : "Générer avec gpt-5.6-luna"}>{busy ? <Loader2 size={16} className="lab-feedback-editor__spin" /> : <Wand2 size={16} />}</button></div></label></div>;
}
