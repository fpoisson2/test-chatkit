import type { VectorStoreSearchResult } from "../utils/backend";

type VectorStoreSearchResultsProps = {
  results: VectorStoreSearchResult[];
  onInspect?: (result: VectorStoreSearchResult) => void;
};

const formatScore = (value: number) => value.toFixed(3);

export const VectorStoreSearchResults = ({
  results,
  onInspect,
}: VectorStoreSearchResultsProps) => {
  if (results.length === 0) {
    return <p className="admin-card__subtitle">Aucun résultat pour cette requête.</p>;
  }

  return (
    <div className="admin-table-wrapper">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Chunk</th>
            <th>Score</th>
            <th>Dense</th>
            <th>BM25</th>
            <th>Extrait</th>
            {onInspect ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={`${result.doc_id}-${result.chunk_index}`}>
              <td>{result.doc_id}</td>
              <td>{result.chunk_index}</td>
              <td>{formatScore(result.score)}</td>
              <td>{formatScore(result.dense_score)}</td>
              <td>{formatScore(result.bm25_score)}</td>
              <td>
                <span className="vector-store__snippet">{result.text}</span>
              </td>
              {onInspect ? (
                <td>
                  <button
                    className="button button--subtle button--sm"
                    type="button"
                    onClick={() => onInspect(result)}
                  >
                    Voir le JSON
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
