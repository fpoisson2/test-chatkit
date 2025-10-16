import { useMemo, useState } from "react";

import { Modal } from "../../../components/Modal";
import type { WidgetTemplate } from "../../../utils/backend";

type WidgetLibraryModalProps = {
  widgets: WidgetTemplate[];
  selectedSlug: string;
  onSelect: (slug: string) => void;
  onClose: () => void;
  title?: string;
  description?: string;
};

const filterWidgets = (widgets: WidgetTemplate[], query: string): WidgetTemplate[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return widgets;
  }
  return widgets.filter((widget) => {
    const haystack = [widget.slug, widget.title ?? "", widget.description ?? ""].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
};

export const WidgetLibraryModal = ({
  widgets,
  selectedSlug,
  onSelect,
  onClose,
  title = "Choisir un widget",
  description = "Sélectionnez un widget existant pour le réutiliser dans ce workflow.",
}: WidgetLibraryModalProps) => {
  const [query, setQuery] = useState("");

  const filteredWidgets = useMemo(() => filterWidgets(widgets, query), [widgets, query]);

  return (
    <Modal title={title} onClose={onClose} size="lg">
      <div style={{ display: "grid", gap: "1rem" }}>
        {description ? (
          <p style={{ margin: 0, color: "#475569", fontSize: "0.95rem" }}>{description}</p>
        ) : null}

        <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <span>Rechercher un widget</span>
          <input
            type="search"
            value={query}
            placeholder="Filtrer par titre, slug ou description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div
          role="listbox"
          aria-label="Widgets disponibles"
          style={{
            display: "grid",
            gap: "0.75rem",
            maxHeight: "50vh",
            overflowY: "auto",
            paddingRight: "0.5rem",
          }}
        >
          {filteredWidgets.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b" }}>
              Aucun widget ne correspond à cette recherche.
            </p>
          ) : (
            filteredWidgets.map((widget) => {
              const isSelected = widget.slug === selectedSlug.trim();
              return (
                <button
                  key={widget.slug}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelect(widget.slug);
                    onClose();
                  }}
                  style={{
                    textAlign: "left",
                    padding: "0.85rem",
                    borderRadius: "0.75rem",
                    border: isSelected ? "2px solid #2563eb" : "1px solid rgba(148, 163, 184, 0.45)",
                    backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                    cursor: "pointer",
                    display: "grid",
                    gap: "0.35rem",
                    transition: "border-color 120ms ease, box-shadow 120ms ease",
                    boxShadow: isSelected ? "0 0 0 4px rgba(37, 99, 235, 0.1)" : undefined,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "0.5rem",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "1rem", color: "#0f172a" }}>
                      {widget.title?.trim() || widget.slug}
                    </span>
                    <code style={{ fontSize: "0.8rem", color: "#475569" }}>{widget.slug}</code>
                  </div>
                  {widget.description ? (
                    <p style={{ margin: 0, color: "#64748b", fontSize: "0.9rem" }}>{widget.description}</p>
                  ) : null}
                  <span style={{ color: "#2563eb", fontSize: "0.85rem" }}>
                    {isSelected ? "Widget sélectionné" : "Sélectionner ce widget"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
};

export default WidgetLibraryModal;

