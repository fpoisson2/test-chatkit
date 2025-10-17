import type { VectorStoreDocument } from "../utils/backend";

type VectorStoreDocumentsTableProps = {
  documents: VectorStoreDocument[];
  isLoading: boolean;
  onInspect: (document: VectorStoreDocument) => void;
  onDelete?: (document: VectorStoreDocument) => void;
};

const serializeMetadata = (
  metadata: Record<string, unknown>,
): { preview: string; full: string | undefined } => {
  const entries = Object.entries(metadata ?? {});
  if (entries.length === 0) {
    return { preview: "—", full: undefined };
  }
  try {
    const serialized = JSON.stringify(metadata);
    const preview = serialized.length > 80 ? `${serialized.slice(0, 77)}…` : serialized;
    return { preview, full: serialized };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Impossible de sérialiser les métadonnées", error);
    }
    return { preview: "Métadonnées non disponibles", full: undefined };
  }
};

export const VectorStoreDocumentsTable = ({
  documents,
  isLoading,
  onInspect,
  onDelete,
}: VectorStoreDocumentsTableProps) => {
  if (isLoading) {
    return <p className="admin-card__subtitle">Chargement des documents…</p>;
  }

  if (documents.length === 0) {
    return (
      <p className="admin-card__subtitle">
        Aucun document n'est associé à ce vector store pour le moment.
      </p>
    );
  }

  return (
    <div className="admin-table-wrapper">
      <table className="admin-table admin-table--stack">
        <thead>
          <tr>
            <th>Identifiant</th>
            <th>Métadonnées</th>
            <th>Segments</th>
            <th>Dernière mise à jour</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const metadataInfo = serializeMetadata(document.metadata ?? {});
            return (
              <tr key={document.doc_id}>
                <td data-label="Identifiant">{document.doc_id}</td>
                <td data-label="Métadonnées">
                  <code className="code-inline" title={metadataInfo.full}>
                    {metadataInfo.preview}
                  </code>
                </td>
                <td data-label="Segments">{document.chunk_count}</td>
                <td data-label="Dernière mise à jour">
                  {new Date(document.updated_at).toLocaleString()}
                </td>
                <td data-label="Actions">
                  <div className="admin-table__actions">
                    <button
                      className="button button--ghost button--sm"
                      type="button"
                      onClick={() => onInspect(document)}
                    >
                      Consulter
                    </button>
                    {onDelete ? (
                      <button
                        className="button button--danger button--sm"
                        type="button"
                        onClick={() => onDelete(document)}
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
  );
};
