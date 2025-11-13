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
    return (
      <div className="empty-state">
        <p className="empty-state-description">Aucun résultat pour cette requête.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
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
                <span className="text-sm">{result.text}</span>
              </td>
              {onInspect ? (
                <td>
                  <button
                    className="btn btn-sm btn-secondary"
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
