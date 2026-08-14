import { useEffect, useRef, useState } from "react";
import { Bold, ImagePlus, Italic, List, Save, Type, X } from "lucide-react";
import type { AgentParameters } from "../../../../types";
import "../../../../lab/lab.css";

type Props = { parameters: AgentParameters; onSave: (html: string) => void; onClose: () => void };

const defaultDocument = (parameters: AgentParameters) => {
  const sections = Array.isArray(parameters.sections) ? parameters.sections as Array<{ title?: string; description?: string; fields?: Array<{ id: string; label?: string }> }> : [];
  return sections.map((section) => `<h2>${section.title ?? "Section"}</h2><p>${section.description ?? ""}</p>${(section.fields ?? []).map((field) => `<p><strong>${field.label ?? "Champ"}</strong></p><p><span data-lab-field="${field.id}" contenteditable="false" class="lab-document-field">[Réponse de l’étudiant]</span></p>`).join("")}`).join("");
};

export function LabDocumentEditor({ parameters, onSave, onClose }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(String(parameters.document_html ?? defaultDocument(parameters)));
  useEffect(() => { if (editorRef.current && editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html; }, [html]);
  const command = (name: string, value?: string) => { editorRef.current?.focus(); document.execCommand(name, false, value); setHtml(editorRef.current?.innerHTML ?? ""); };
  const insertField = () => {
    const sections = Array.isArray(parameters.sections) ? parameters.sections as Array<{ fields?: Array<{ id: string; label?: string }> }> : [];
    const fields = sections.flatMap((section) => section.fields ?? []);
    const field = fields[0];
    if (!field) return;
    const selected = window.prompt("Identifiant du champ à insérer", field.id);
    if (!selected) return;
    command("insertHTML", `<span data-lab-field="${selected}" contenteditable="false" class="lab-document-field">[Champ: ${selected}]</span>&nbsp;`);
  };
  const insertImage = (file: File) => { const reader = new FileReader(); reader.onload = () => command("insertHTML", `<img src="${String(reader.result)}" alt="Image du laboratoire" class="lab-document-image" />`); reader.readAsDataURL(file); };
  return <div className="lab-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="lab-editor-modal" role="dialog" aria-modal="true" aria-label="Éditeur de laboratoire"><header className="lab-editor-header"><div><span className="lab-eyebrow">Builder · document</span><h2>{String(parameters.title ?? "Laboratoire")}</h2></div><button type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></header><div className="lab-editor-toolbar"><button type="button" onClick={() => command("formatBlock", "h1")}><Type size={15} /> Titre</button><button type="button" onClick={() => command("bold")}><Bold size={15} /> Gras</button><button type="button" onClick={() => command("italic")}><Italic size={15} /> Italique</button><button type="button" onClick={() => command("insertUnorderedList")}><List size={15} /> Liste</button><button type="button" onClick={insertField}><Type size={15} /> Champ</button><label><ImagePlus size={15} /> Image<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) insertImage(file); event.currentTarget.value = ""; }} /></label></div><div ref={editorRef} className="lab-document-editor" contentEditable suppressContentEditableWarning onInput={(event) => setHtml(event.currentTarget.innerHTML)} data-placeholder="Commencez à composer le document…" /><footer className="lab-editor-footer"><span>Les champs insérés conservent leur identifiant pour la correction IA.</span><button type="button" className="lab-button lab-button--primary" onClick={() => { onSave(html); onClose(); }}><Save size={16} /> Enregistrer le document</button></footer></section></div>;
}
