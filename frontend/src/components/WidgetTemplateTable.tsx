import type { WidgetTemplate } from "../utils/backend";

type WidgetTemplateTableProps = {
  widgets: WidgetTemplate[];
  isLoading: boolean;
  onPreview: (widget: WidgetTemplate) => void;
  onEdit: (widget: WidgetTemplate) => void;
  onDelete: (widget: WidgetTemplate) => void;
};

export const WidgetTemplateTable = ({
  widgets,
  isLoading,
  onPreview,
  onEdit,
  onDelete,
}: WidgetTemplateTableProps) => {
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
    <div className="admin-table-wrapper">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Slug</th>
            <th>Titre</th>
            <th>Description</th>
            <th>Dernière mise à jour</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {widgets.map((widget) => (
            <tr key={widget.slug}>
              <td>{widget.slug}</td>
              <td>{widget.title ?? "—"}</td>
              <td>{widget.description ?? "—"}</td>
              <td>{new Date(widget.updated_at).toLocaleString()}</td>
              <td>
                <div className="admin-table__actions">
                  <button
                    className="button button--ghost button--sm"
                    type="button"
                    onClick={() => onPreview(widget)}
                  >
                    Prévisualiser
                  </button>
                  <button
                    className="button button--subtle button--sm"
                    type="button"
                    onClick={() => onEdit(widget)}
                  >
                    Modifier
                  </button>
                  <button
                    className="button button--danger button--sm"
                    type="button"
                    onClick={() => onDelete(widget)}
                  >
                    Supprimer
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
