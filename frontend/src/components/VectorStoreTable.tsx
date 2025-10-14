import type { VectorStoreSummary } from "../utils/backend";

type VectorStoreTableProps = {
  stores: VectorStoreSummary[];
  isLoading: boolean;
  onIngest: (store: VectorStoreSummary) => void;
  onSearch: (store: VectorStoreSummary) => void;
  onDelete?: (store: VectorStoreSummary) => void;
};

export const VectorStoreTable = ({
  stores,
  isLoading,
  onIngest,
  onSearch,
  onDelete,
}: VectorStoreTableProps) => {
  if (isLoading) {
    return <p className="admin-card__subtitle">Chargement des vector stores…</p>;
  }

  if (stores.length === 0) {
    return (
      <p className="admin-card__subtitle">
        Aucun vector store pour le moment. Créez-en un pour commencer l'ingestion.
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
            <th>Documents</th>
            <th>Dernière mise à jour</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <tr key={store.slug}>
              <td>{store.slug}</td>
              <td>{store.title ?? "—"}</td>
              <td>{store.documents_count}</td>
              <td>{new Date(store.updated_at).toLocaleString()}</td>
              <td>
                <div className="admin-table__actions">
                  <button
                    className="button button--subtle button--sm"
                    type="button"
                    onClick={() => onIngest(store)}
                  >
                    Ingestion JSON
                  </button>
                  <button
                    className="button button--ghost button--sm"
                    type="button"
                    onClick={() => onSearch(store)}
                  >
                    Tester une requête
                  </button>
                  {onDelete ? (
                    <button
                      className="button button--danger button--sm"
                      type="button"
                      onClick={() => onDelete(store)}
                    >
                      Supprimer
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
