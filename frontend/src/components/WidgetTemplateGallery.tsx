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
      return <p className="widget-gallery__empty">Chargement des widgets…</p>;
    }

    if (widgets.length === 0) {
      return (
        <p className="widget-gallery__empty">
          Aucun widget enregistré pour le moment. Créez une carte ou un tableau de bord pour vos agents.
        </p>
      );
    }

    return (
      <div className="widget-gallery" role="list">
        {widgets.map((widget) => (
          <article key={widget.slug} className="widget-gallery__item" role="listitem">
            <div className="widget-gallery__preview">
              <div className="widget-gallery__preview-canvas" aria-hidden={true}>
                <WidgetPreview definition={widget.definition} />
              </div>

              <div className="widget-gallery__actions">
                <button
                  className="button button--ghost button--sm"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreview(widget);
                  }}
                >
                  Voir en plein écran
                </button>
                <button
                  className="button button--subtle button--sm"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(widget);
                  }}
                >
                  Modifier
                </button>
                <button
                  className="button button--danger button--sm"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(widget);
                  }}
                >
                  Supprimer
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }, [isLoading, onDelete, onEdit, onPreview, widgets]);

  return content;
};
