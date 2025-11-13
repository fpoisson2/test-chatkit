import { WORKFLOW_VECTOR_STORE_SLUG, type VectorStoreSummary } from "../utils/backend";

type VectorStoreTableProps = {
  stores: VectorStoreSummary[];
  isLoading: boolean;
  onIngest: (store: VectorStoreSummary) => void;
  onSearch: (store: VectorStoreSummary) => void;
  onDocuments?: (store: VectorStoreSummary) => void;
  onDelete?: (store: VectorStoreSummary) => void;
};

export const VectorStoreTable = ({
  stores,
  isLoading,
  onIngest,
  onSearch,
  onDocuments,
  onDelete,
}: VectorStoreTableProps) => {
  if (isLoading) {
    return <p className="text-center text-secondary py-8">Chargement des vector stores…</p>;
  }

  if (stores.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-description">
          Aucun vector store pour le moment. Créez-en un pour commencer l'ingestion.
        </p>
      </div>
    );
  }

  return (
    <div className="vector-store-list">
      <div className="vector-store-list__table">
        <div className="overflow-x-auto">
          <table className="table">
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
              {stores.map((store) => {
                const isProtected = store.slug === WORKFLOW_VECTOR_STORE_SLUG;
                return (
                  <tr key={store.slug}>
                    <td>{store.slug}</td>
                    <td>{store.title ?? "—"}</td>
                    <td>{store.documents_count}</td>
                    <td>{new Date(store.updated_at).toLocaleString()}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-sm btn-secondary"
                          type="button"
                          onClick={() => onIngest(store)}
                        >
                          Ingestion JSON
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          type="button"
                          onClick={() => onSearch(store)}
                        >
                          Tester une requête
                        </button>
                        {onDocuments ? (
                          <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            onClick={() => onDocuments(store)}
                          >
                            Documents
                          </button>
                        ) : null}
                        {onDelete && !isProtected ? (
                          <button
                            className="btn btn-sm btn-danger"
                            type="button"
                            onClick={() => onDelete(store)}
                          >
                            Supprimer
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="vector-store-list__cards">
        {stores.map((store) => {
          const isProtected = store.slug === WORKFLOW_VECTOR_STORE_SLUG;
          return (
            <article className="card" key={store.slug}>
              <div className="card-body">
                <header className="mb-4">
                  <h3 className="card-title">{store.title ?? "Sans titre"}</h3>
                  <p className="text-sm text-secondary">{store.slug}</p>
                </header>
                <dl className="flex flex-col gap-2 mb-4">
                  <div className="flex justify-between">
                    <dt className="font-medium">Documents</dt>
                    <dd>{store.documents_count}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="font-medium">Dernière mise à jour</dt>
                    <dd>{new Date(store.updated_at).toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
              <div className="card-footer flex items-center gap-2 flex-wrap">
                <button
                  className="btn btn-sm btn-secondary"
                  type="button"
                  onClick={() => onIngest(store)}
                >
                  Ingestion JSON
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => onSearch(store)}
                >
                  Tester une requête
                </button>
                {onDocuments ? (
                  <button
                    className="btn btn-sm btn-ghost"
                    type="button"
                    onClick={() => onDocuments(store)}
                  >
                    Documents
                  </button>
                ) : null}
                {onDelete && !isProtected ? (
                  <button
                    className="btn btn-sm btn-danger"
                    type="button"
                    onClick={() => onDelete(store)}
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
