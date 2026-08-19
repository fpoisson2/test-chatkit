import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlignLeft, BadgeCheck, Bold, CheckSquare, ChevronDown, ChevronUp, Download, ExternalLink,
  Hash, Heading2, Heading3, Highlighter, Image as ImageIcon, ImagePlus, Italic, List, ListOrdered,
  Plus, Save, Table as TableIcon, Trash2, Type, Upload, X,
} from "lucide-react";
import "./lab-editor.css";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type Option = { id: string; label: string; input_type?: string; unit?: string; options?: string[] };
type Field = Record<string, unknown> & { id: string; type: string; label: string };
type Block =
  | { key: string; type: "markdown"; content: string }
  | { key: string; type: "field"; field: Field };

/* ------------------------------------------------------------------ *
 * Markdown <-> HTML
 * ------------------------------------------------------------------ */

const markdownToHtml = (markdown: string) =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>);

const INLINE_WRAPPERS: Record<string, [string, string]> = {
  STRONG: ["**", "**"], B: ["**", "**"],
  EM: ["*", "*"], I: ["*", "*"],
  MARK: ["==", "=="], CODE: ["`", "`"],
  DEL: ["~~", "~~"], S: ["~~", "~~"], STRIKE: ["~~", "~~"],
};

const BLOCK_TAGS = new Set([
  "P", "DIV", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "PRE", "TABLE", "HR", "SECTION", "ARTICLE",
]);

const hasBlockChild = (element: HTMLElement) =>
  Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName));

/** Serialise inline content (text + emphasis + links + images) to Markdown. */
function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  if (element.tagName === "BR") return "\n";
  if (element.tagName === "IMG") return `![${element.getAttribute("alt") ?? ""}](${element.getAttribute("src") ?? ""})`;
  const children = Array.from(element.childNodes).map(inlineMarkdown).join("");
  if (element.tagName === "A") return `[${children}](${element.getAttribute("href") ?? ""})`;
  const wrapper = INLINE_WRAPPERS[element.tagName];
  if (wrapper) return children.trim() ? `${wrapper[0]}${children}${wrapper[1]}` : children;
  if (element.tagName === "SPAN" && element.style.backgroundColor) {
    return children.trim() ? `==${children}==` : children;
  }
  return children;
}

function listMarkdown(list: HTMLElement, depth: number): string {
  const ordered = list.tagName === "OL";
  const padding = "  ".repeat(depth);
  let output = "", counter = 1;
  Array.from(list.children).forEach((item) => {
    if (item.tagName !== "LI") return;
    const nested: string[] = [];
    const own: Node[] = [];
    item.childNodes.forEach((child) => {
      const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName : "";
      if (tag === "UL" || tag === "OL") nested.push(listMarkdown(child as HTMLElement, depth + 1));
      else own.push(child);
    });
    const text = own.map(inlineMarkdown).join("").trim();
    output += `${padding}${ordered ? `${counter++}.` : "-"} ${text}\n`;
    output += nested.join("");
  });
  return output;
}

function tableMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return "";
  const cells = (row: Element) =>
    Array.from(row.children).map((cell) => inlineMarkdown(cell).trim().replace(/\|/g, "\\|") || " ");
  const header = cells(rows[0]);
  let output = `| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n`;
  rows.slice(1).forEach((row) => { output += `| ${cells(row).join(" | ")} |\n`; });
  return `${output}\n`;
}

function blockMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").trim();
    return text ? `${text}\n\n` : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  const tag = element.tagName;
  const recurse = () => Array.from(element.childNodes).map(blockMarkdown).join("");

  if (/^H[1-6]$/.test(tag)) {
    const text = inlineMarkdown(element).trim();
    return text ? `${"#".repeat(Number(tag.slice(1)))} ${text}\n\n` : "";
  }
  if (tag === "UL" || tag === "OL") return `${listMarkdown(element, 0)}\n`;
  if (tag === "TABLE") return tableMarkdown(element);
  if (tag === "HR") return "---\n\n";
  if (tag === "PRE") return `\`\`\`\n${element.textContent ?? ""}\n\`\`\`\n\n`;
  if (tag === "BLOCKQUOTE") {
    const inner = recurse().trim();
    return inner ? `${inner.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")}\n\n` : "";
  }
  if (hasBlockChild(element)) return recurse();
  const text = inlineMarkdown(element).trim();
  return text ? `${text}\n\n` : "";
}

const htmlToMarkdown = (root: HTMLElement) =>
  Array.from(root.childNodes).map(blockMarkdown).join("").replace(/\n{3,}/g, "\n\n").trim();

/* ------------------------------------------------------------------ *
 * Field directives
 * ------------------------------------------------------------------ */

const quote = (value: unknown) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

function directive(field: Field) {
  const attributes = Object.entries(field)
    .filter(([key, value]) => key !== "type" && key !== "section" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      if (key === "options" && Array.isArray(value)) {
        return `${key}=${quote((value as Option[]).map((item) => `${item.id}:${item.label}`).join("|"))}`;
      }
      if (key === "rows" && Array.isArray(value)) {
        return `${key}=${quote((value as Option[]).map((item) => `${item.id}:${item.label}`).join("|"))}`;
      }
      if (key === "columns" && Array.isArray(value)) {
        return `${key}=${quote((value as Option[]).map((item) => {
          const extra = item.input_type === "select"
            ? (item.options?.length ? `:${item.options.join(";")}` : "")
            : (item.unit ? `:${item.unit}` : "");
          return `${item.id}:${item.label}:${item.input_type ?? "text"}${extra}`;
        }).join("|"))}`;
      }
      if (Array.isArray(value)) return `${key}=${quote(value.join(","))}`;
      return `${key}=${typeof value === "boolean" || typeof value === "number" ? value : quote(value)}`;
    });
  return `{{ ${field.type} ${attributes.join(" ")} }}`;
}

const FIELD_TYPES: { type: string; label: string }[] = [
  { type: "text", label: "Texte court" },
  { type: "textarea", label: "Texte long" },
  { type: "number", label: "Nombre" },
  { type: "checkbox", label: "Case à cocher" },
  { type: "select", label: "Liste déroulante" },
  { type: "radio", label: "Choix multiple" },
  { type: "image", label: "Image" },
  { type: "table", label: "Tableau" },
  { type: "matrix", label: "Matrice" },
  { type: "teacher_validation", label: "Validation enseignante" },
];

const FIELD_LABEL = (type: string) => FIELD_TYPES.find((item) => item.type === type)?.label ?? type;

const slugify = (value: string, fallback: string) => {
  const slug = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return /^[a-z][a-z0-9_]{1,127}$/.test(slug) ? slug : fallback;
};

const uid = () => Math.random().toString(36).slice(2, 8);

function newField(type: string): Field {
  const base: Field = { id: `champ_${uid()}`, type, label: FIELD_LABEL(type) };
  if (type === "textarea") return { ...base, rows: 3 };
  if (type === "select" || type === "radio") {
    return { ...base, options: [{ id: "choix_1", label: "Choix 1" }, { id: "choix_2", label: "Choix 2" }] };
  }
  if (type === "table" || type === "matrix") {
    return {
      ...base,
      rows: [{ id: "ligne_1", label: "Ligne 1" }, { id: "ligne_2", label: "Ligne 2" }],
      columns: [{ id: "colonne_1", label: "Colonne 1", input_type: "text" }],
    };
  }
  return base;
}

/** Coerce a field when its type changes so the directive stays valid. */
function retype(field: Field, type: string): Field {
  const next: Field = { ...field, type };
  const needsOptions = type === "select" || type === "radio";
  const needsGrid = type === "table" || type === "matrix";
  if (!needsOptions) delete next.options;
  else if (!Array.isArray(next.options)) next.options = newField("select").options;
  if (!needsGrid) { if (Array.isArray(next.rows)) delete next.rows; delete next.columns; delete next.visible_columns; }
  else {
    if (!Array.isArray(next.rows)) next.rows = newField("table").rows;
    if (!Array.isArray(next.columns)) next.columns = newField("table").columns;
  }
  if (type === "textarea" && typeof next.rows !== "number") next.rows = 3;
  return next;
}

/* ------------------------------------------------------------------ *
 * Inline editable text (used for labels, options, headers)
 * ------------------------------------------------------------------ */

function InlineText({ value, onChange, placeholder, className }: {
  value: string; onChange: (value: string) => void; placeholder?: string; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [initial] = useState(value);
  useEffect(() => {
    // Sync only when the value changed outside of this element (e.g. undo, type switch).
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value]);
  return (
    <span
      ref={ref}
      className={`lab-inline-text ${className ?? ""}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      data-placeholder={placeholder}
      onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
    >
      {initial}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Rich text surface (one Markdown block)
 * ------------------------------------------------------------------ */

function RichTextSurface({ content, onChange, registerSurface, onFocus }: {
  content: string;
  onChange: (markdown: string) => void;
  registerSurface: (element: HTMLDivElement | null) => void;
  onFocus: () => void;
}) {
  // Frozen initial HTML: React never rewrites the DOM the user is editing.
  const [html] = useState(() => markdownToHtml(content));
  return (
    <div
      className="lab-editor-surface"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Contenu du laboratoire"
      ref={registerSurface}
      onFocus={onFocus}
      onInput={(event) => onChange(htmlToMarkdown(event.currentTarget))}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Formatting toolbar
 * ------------------------------------------------------------------ */

type ToolbarProps = {
  onCommand: (run: () => void) => void;
  onInsertField: (type: string) => void;
  onInsertImage: () => void;
};

function FormatToolbar({ onCommand, onInsertField, onInsertImage }: ToolbarProps) {
  const exec = (command: string, value?: string) => onCommand(() => {
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, value);
  });
  const insertTable = () => onCommand(() => document.execCommand(
    "insertHTML", false,
    "<table><tbody><tr><th>Colonne 1</th><th>Colonne 2</th></tr><tr><td>Valeur</td><td>Valeur</td></tr></tbody></table><p><br></p>",
  ));
  const button = (key: string, title: string, icon: ReactNode, action: () => void) => (
    <button key={key} type="button" title={title} aria-label={title} onMouseDown={(event) => event.preventDefault()} onClick={action}>
      {icon}
    </button>
  );
  return (
    <div className="lab-format-menu" role="toolbar" aria-label="Mise en forme">
      <div className="lab-format-menu__group">
        {button("bold", "Gras", <Bold size={15} />, () => exec("bold"))}
        {button("italic", "Italique", <Italic size={15} />, () => exec("italic"))}
        {button("mark", "Surligné", <Highlighter size={15} />, () => exec("backColor", "#fff3a3"))}
        {button("h2", "Titre", <Heading2 size={15} />, () => exec("formatBlock", "h2"))}
        {button("h3", "Sous-titre", <Heading3 size={15} />, () => exec("formatBlock", "h3"))}
        {button("ul", "Liste à puces", <List size={15} />, () => exec("insertUnorderedList"))}
        {button("ol", "Liste numérotée", <ListOrdered size={15} />, () => exec("insertOrderedList"))}
        {button("table", "Tableau", <TableIcon size={15} />, insertTable)}
        {button("image", "Insérer une image", <ImagePlus size={15} />, onInsertImage)}
      </div>
      <span className="lab-format-menu__separator" aria-hidden="true" />
      <div className="lab-format-menu__group">
        <span className="lab-format-menu__caption">Champs</span>
        {button("f-text", "Champ — texte court", <Type size={15} />, () => onInsertField("text"))}
        {button("f-textarea", "Champ — texte long", <AlignLeft size={15} />, () => onInsertField("textarea"))}
        {button("f-number", "Champ — nombre", <Hash size={15} />, () => onInsertField("number"))}
        {button("f-checkbox", "Champ — case à cocher", <CheckSquare size={15} />, () => onInsertField("checkbox"))}
        {button("f-select", "Champ — liste déroulante", <List size={15} />, () => onInsertField("select"))}
        {button("f-image", "Champ — image", <ImageIcon size={15} />, () => onInsertField("image"))}
        {button("f-table", "Champ — tableau", <TableIcon size={15} />, () => onInsertField("table"))}
        {button("f-validation", "Champ — validation enseignante", <BadgeCheck size={15} />, () => onInsertField("teacher_validation"))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Visual field card
 * ------------------------------------------------------------------ */

function FieldCard({ field, onChange }: { field: Field; onChange: (field: Field) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...field, [key]: value });
  const options = (Array.isArray(field.options) ? field.options : []) as Option[];
  const rows = (Array.isArray(field.rows) ? field.rows : []) as Option[];
  const columns = (Array.isArray(field.columns) ? field.columns : []) as Option[];
  const unit = typeof field.unit === "string" ? field.unit : "";

  const label = (
    <span className="lab-field-card__label">
      <InlineText value={field.label} placeholder="Libellé du champ" onChange={(value) => set("label", value)} />
      {unit && <em className="lab-field-card__unit">({unit})</em>}
      {field.required === true && <em className="lab-field-card__required"> *</em>}
    </span>
  );

  const setOption = (index: number, value: string) =>
    set("options", options.map((item, position) => position === index
      ? { ...item, label: value, id: item.id || slugify(value, `choix_${index + 1}`) }
      : item));

  return (
    <div className="lab-field-card">
      <div className="lab-field-card__bar">
        <span className="lab-field-card__kind">Champ interactif</span>
        <select value={field.type} aria-label="Type de champ" onChange={(event) => onChange(retype(field, event.target.value))}>
          {FIELD_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
        </select>
        <label className="lab-field-card__id">
          id
          <input
            value={field.id}
            aria-label="Identifiant du champ"
            onChange={(event) => set("id", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
          />
        </label>
        {field.type !== "teacher_validation" && (
          <label className="lab-field-card__unit-input">
            unité
            <input value={unit} aria-label="Unité" onChange={(event) => set("unit", event.target.value)} />
          </label>
        )}
        {field.type !== "teacher_validation" && (
          <label className="lab-field-card__toggle">
            <input type="checkbox" checked={field.required === true} onChange={(event) => set("required", event.target.checked || undefined)} />
            Obligatoire
          </label>
        )}
      </div>

      <div className="lab-field-card__preview">
        {field.type === "checkbox" && <label className="lab-preview-check"><input type="checkbox" disabled />{label}</label>}
        {field.type !== "checkbox" && label}

        {field.type === "text" && <input disabled placeholder="Réponse de l’étudiant" />}
        {field.type === "number" && <input disabled type="number" placeholder="0" />}
        {field.type === "textarea" && (
          <textarea disabled rows={typeof field.rows === "number" ? field.rows : 3} placeholder="Réponse de l’étudiant" />
        )}
        {field.type === "image" && <div className="lab-preview-image"><ImagePlus size={18} /> Téléversement d’image par l’étudiant</div>}
        {field.type === "teacher_validation" && (
          <div className="lab-preview-validation"><BadgeCheck size={18} /> Validation à effectuer par la personne enseignante.</div>
        )}

        {(field.type === "select" || field.type === "radio") && (
          <ul className="lab-preview-options">
            {options.map((option, index) => (
              <li key={option.id || index}>
                <span className="lab-preview-options__marker" aria-hidden="true">{field.type === "radio" ? "◯" : "▾"}</span>
                <InlineText value={option.label} placeholder="Libellé du choix" onChange={(value) => setOption(index, value)} />
                <button type="button" title="Retirer ce choix" onClick={() => set("options", options.filter((_, position) => position !== index))}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="lab-inline-add" onClick={() => set("options", [...options, { id: `choix_${uid()}`, label: `Choix ${options.length + 1}` }])}>
                <Plus size={13} /> Ajouter un choix
              </button>
            </li>
          </ul>
        )}

        {(field.type === "table" || field.type === "matrix") && (
          <div className="lab-preview-grid">
            <table>
              <thead>
                <tr>
                  <th />
                  {columns.map((column, index) => (
                    <th key={column.id || index}>
                      <InlineText
                        value={column.label}
                        placeholder="Colonne"
                        onChange={(value) => set("columns", columns.map((item, position) => position === index
                          ? { ...item, label: value, id: item.id || slugify(value, `colonne_${index + 1}`) } : item))}
                      />
                      <select
                        aria-label={`Type de la colonne ${column.label}`}
                        value={column.input_type ?? "text"}
                        onChange={(event) => set("columns", columns.map((item, position) => position === index
                          ? { ...item, input_type: event.target.value } : item))}
                      >
                        {["text", "number", "select", "color", "readonly"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                      </select>
                      <button type="button" title="Retirer la colonne" onClick={() => set("columns", columns.filter((_, position) => position !== index))}>
                        <Trash2 size={12} />
                      </button>
                    </th>
                  ))}
                  <th className="lab-preview-grid__add">
                    <button type="button" title="Ajouter une colonne" onClick={() => set("columns", [...columns, { id: `colonne_${uid()}`, label: `Colonne ${columns.length + 1}`, input_type: "text" }])}>
                      <Plus size={13} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id || index}>
                    <th>
                      <InlineText
                        value={row.label}
                        placeholder="Ligne"
                        onChange={(value) => set("rows", rows.map((item, position) => position === index
                          ? { ...item, label: value, id: item.id || slugify(value, `ligne_${index + 1}`) } : item))}
                      />
                      <button type="button" title="Retirer la ligne" onClick={() => set("rows", rows.filter((_, position) => position !== index))}>
                        <Trash2 size={12} />
                      </button>
                    </th>
                    {columns.map((column, position) => <td key={column.id || position}><input disabled /></td>)}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="lab-inline-add" onClick={() => set("rows", [...rows, { id: `ligne_${uid()}`, label: `Ligne ${rows.length + 1}` }])}>
              <Plus size={13} /> Ajouter une ligne
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

export default function LabVisualEditor({ slug, token, onClose, onPublished }: {
  slug: string; token: string; onClose: () => void; onPublished: (message: string) => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [replacement, setReplacement] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeKey, setActiveKey] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const surfaces = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    fetch(`/api/labs/admin/${slug}/editor`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).detail);
        return response.json();
      })
      .then((result: { definition: { blocks: ({ type: "markdown"; content: string } | { type: "field"; field: Field })[] } }) => {
        setBlocks(result.definition.blocks.map((block) => ({ ...block, key: `b_${uid()}` } as Block)));
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  }, [slug, token]);

  const source = useMemo(
    () => blocks.map((block) => block.type === "markdown" ? block.content.trim() : directive(block.field)).filter(Boolean).join("\n\n"),
    [blocks],
  );

  const change = useCallback((key: string, block: Block) =>
    setBlocks((current) => current.map((item) => item.key === key ? block : item)), []);

  const move = (key: string, delta: number) => setBlocks((current) => {
    const index = current.findIndex((item) => item.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const copy = [...current];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  });

  const remove = (key: string) => setBlocks((current) => current.filter((item) => item.key !== key));

  /** Insert a block right after the block the caret is in (or at the end). */
  const insertAfterActive = (block: Omit<Block, "key">) => setBlocks((current) => {
    const entry = { ...block, key: `b_${uid()}` } as Block;
    const index = current.findIndex((item) => item.key === activeKey);
    if (index < 0) return [...current, entry];
    return [...current.slice(0, index + 1), entry, ...current.slice(index + 1)];
  });

  const addMarkdown = () => insertAfterActive({ type: "markdown", content: "## Nouvelle section\n\nVotre texte." });
  const insertField = (type: string) => insertAfterActive({ type: "field", field: newField(type) });

  /** Run an execCommand-style action against the currently focused surface. */
  const runOnSurface = (run: () => void) => {
    const entry = surfaces.current.has(activeKey)
      ? ([activeKey, surfaces.current.get(activeKey)!] as const)
      : ([...surfaces.current.entries()][0] as [string, HTMLDivElement] | undefined);
    if (!entry) return;
    const [key, surface] = entry;
    surface.focus();
    const selection = window.getSelection();
    if (selection && (!selection.rangeCount || !surface.contains(selection.anchorNode))) {
      const range = document.createRange();
      range.selectNodeContents(surface);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    run();
    change(key, { key, type: "markdown", content: htmlToMarkdown(surface) });
  };

  const uploadImage = async (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/labs/admin/${slug}/assets`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!response.ok) { setError((await response.json()).detail); return; }
    const result = await response.json() as { url: string; name: string };
    runOnSurface(() => document.execCommand("insertHTML", false, `<img src="${result.url}" alt="${result.name}" /><p><br></p>`));
  };

  const publish = async () => {
    setBusy(true); setError("");
    const response = await fetch(`/api/labs/admin/${slug}/editor`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    if (!response.ok) {
      setError((await response.json()).detail ?? "Publication impossible");
      setBusy(false);
      return;
    }
    const result = await response.json();
    onPublished(`Version ${result.version} publiée depuis l’éditeur visuel.`);
    onClose();
  };

  const publishUploadedVersion = async () => {
    if (!replacement) return;
    setUploading(true); setError("");
    const form = new FormData();
    form.append("file", replacement);
    const response = await fetch(`/api/labs/admin/${slug}/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!response.ok) {
      setError((await response.json()).detail ?? "Publication impossible");
      setUploading(false);
      return;
    }
    const result = await response.json();
    onPublished(`Version ${result.version} publiée.`);
    onClose();
  };

  const downloadMarkdown = () => {
    const url = URL.createObjectURL(new Blob([`${source}\n`], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="lab-visual-backdrop">
      <section className="lab-visual-editor">
        <header>
          <div><span className="lab-kicker">Éditeur visuel</span><h2>Modifier {slug}</h2></div>
          <button onClick={onClose} aria-label="Fermer"><X /></button>
        </header>

        <FormatToolbar onCommand={runOnSurface} onInsertField={insertField} onInsertImage={() => imageInput.current?.click()} />

        <div className="lab-visual-toolbar">
          <button className="lab-button" onClick={addMarkdown}><Plus size={17} /> Ajouter du texte</button>
          <button className="lab-button lab-button--primary" disabled={busy} onClick={() => void publish()}><Save size={17} /> Publier la version</button>
          <a className="lab-button" href={`/lab/${slug}`} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Prévisualiser</a>
          <button className="lab-button" onClick={downloadMarkdown}><Download size={17} /> Télécharger le Markdown</button>
        </div>

        {error && <div className="lab-inline-error">{error}</div>}

        <div className="lab-editor-publish">
          <div>
            <strong>Publier une nouvelle version</strong>
            <span>Markdown seul ou ZIP contenant le Markdown et ses images.</span>
          </div>
          <label className="lab-button">
            <Upload size={17} /> Choisir le fichier
            <input type="file" accept=".md,.zip,text/markdown,application/zip" onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} />
          </label>
          <span className="lab-editor-publish__file">{replacement?.name}</span>
          <button className="lab-button lab-button--primary" disabled={!replacement || uploading} onClick={() => void publishUploadedVersion()}>Publier</button>
        </div>

        <div className="lab-visual-canvas">
          {busy && !blocks.length ? <p>Chargement…</p> : blocks.map((block) => (
            <article
              className={`lab-editor-block ${activeKey === block.key ? "is-active" : ""}`}
              key={block.key}
              onFocusCapture={() => setActiveKey(block.key)}
            >
              <div className="lab-editor-block__actions">
                <button title="Monter" onClick={() => move(block.key, -1)}><ChevronUp size={15} /></button>
                <button title="Descendre" onClick={() => move(block.key, 1)}><ChevronDown size={15} /></button>
                <button title="Supprimer" onClick={() => remove(block.key)}><Trash2 size={15} /></button>
              </div>
              {block.type === "markdown" ? (
                <RichTextSurface
                  content={block.content}
                  onFocus={() => setActiveKey(block.key)}
                  registerSurface={(element) => {
                    if (element) surfaces.current.set(block.key, element);
                    else surfaces.current.delete(block.key);
                  }}
                  onChange={(content) => change(block.key, { key: block.key, type: "markdown", content })}
                />
              ) : (
                <FieldCard field={block.field} onChange={(field) => change(block.key, { key: block.key, type: "field", field })} />
              )}
            </article>
          ))}
        </div>

        <input
          ref={imageInput}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(event) => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }}
        />
      </section>
    </div>
  );
}
