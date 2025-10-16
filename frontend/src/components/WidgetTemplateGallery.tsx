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

const formatUpdatedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
      return <p className="admin-card__subtitle">Chargement des widgets…</p>;
    }

    if (widgets.length === 0) {
      return (
        <p className="admin-card__subtitle">
          Aucun widget enregistré pour le moment. Créez une carte ou un tableau de bord pour vos agents.
        </p>
      );
    }

    return (
      <div className="widget-gallery" role="list">
        {widgets.map((widget) => (
          <article
            key={widget.slug}
            className="widget-gallery__item"
            role="listitem"
            tabIndex={0}
            aria-label={`Modifier le widget ${widget.title ?? widget.slug}`}
            onClick={() => onEdit(widget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEdit(widget);
              }
            }}
          >
            <header className="widget-gallery__header">
              <div className="widget-gallery__identity">
                <p className="widget-gallery__slug">{widget.slug}</p>
                <h3 className="widget-gallery__title">{widget.title ?? widget.slug}</h3>
              </div>
              <time className="widget-gallery__meta" dateTime={widget.updated_at}>
                Mis à jour le {formatUpdatedAt(widget.updated_at)}
              </time>
            </header>

            {widget.description ? (
              <p className="widget-gallery__description">{widget.description}</p>
            ) : null}

            <div className="widget-gallery__preview" aria-hidden>
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
          </article>
        ))}
      </div>
    );
  }, [isLoading, onDelete, onEdit, onPreview, widgets]);

  return content;
};
