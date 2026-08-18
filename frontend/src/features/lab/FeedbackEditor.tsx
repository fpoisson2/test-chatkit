import { Sparkles } from "lucide-react";

export default function FeedbackEditor({ value, onChange, onGenerate, busy = false }: { value: string; onChange: (value: string) => void; onGenerate: () => void; busy?: boolean }) {
  return <div className="lab-feedback-editor"><label>Rétroaction<textarea rows={6} value={value} onChange={event => onChange(event.target.value)} /></label><button type="button" className="lab-button" onClick={onGenerate} disabled={busy}><Sparkles size={16} /> {busy ? "Génération…" : "Générer avec gpt-5.6-luna"}</button></div>;
}
