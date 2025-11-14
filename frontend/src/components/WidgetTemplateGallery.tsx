import { useMemo } from "react";

import { WidgetPreview } from "./WidgetPreview";

import type { WidgetTemplate } from "../utils/backend";

type WidgetTemplateGalleryProps = {
  widgets: WidgetTemplate[];
  isLoading: boolean;
  onPreview: (widget: WidgetTemplate) => void;
  onEdit: (widget: WidgetTemplate) => void;
  onDelete: (widget: WidgetTemplate) => void;
};

export const WidgetTemplateGallery = ({
  widgets,
  isLoading,
  onPreview,
  onEdit,
  onDelete,
}: WidgetTemplateGalleryProps) => {
  const content = useMemo(() => {
    if (isLoading) {
      return <p className="text-center text-secondary py-8">Chargement des widgets…</p>;
    }

    if (widgets.length === 0) {
      return (
        <div className="empty-state">
          <p className="empty-state-description">
            Aucun widget enregistré pour le moment. Créez une carte ou un tableau de bord pour vos agents.
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-6" role="list">
        {widgets.map((widget) => (
          <article key={widget.slug} className="card widget-library-card" role="listitem">
            <div className="card-body widget-library-preview">
              <WidgetPreview definition={widget.definition} />
            </div>

            <div className="card-footer widget-library-actions flex items-center gap-2">
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPreview(widget);
                }}
              >
                Voir en plein écran
              </button>
              <button
                className="btn btn-sm btn-secondary"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(widget);
                }}
              >
                Modifier
              </button>
              <button
                className="btn btn-sm btn-danger"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(widget);
                }}
              >
                Supprimer
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }, [isLoading, onDelete, onEdit, onPreview, widgets]);

  return content;
};
