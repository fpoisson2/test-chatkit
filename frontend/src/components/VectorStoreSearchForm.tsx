import { FormEvent, useState } from "react";

import type { VectorStoreSearchPayload } from "../utils/backend";

type VectorStoreSearchFormProps = {
  onSubmit: (payload: VectorStoreSearchPayload) => Promise<void>;
};

export const VectorStoreSearchForm = ({ onSubmit }: VectorStoreSearchFormProps) => {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [metadataFiltersInput, setMetadataFiltersInput] = useState("");
  const [denseWeight, setDenseWeight] = useState(0.5);
  const [sparseWeight, setSparseWeight] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!query.trim()) {
      setError("Saisissez une requête.");
      return;
    }

    let metadataFilters: Record<string, unknown> | undefined;
    if (metadataFiltersInput.trim()) {
      try {
        metadataFilters = JSON.parse(metadataFiltersInput) as Record<string, unknown>;
      } catch {
        setError("Les filtres doivent être un JSON valide.");
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        query: query.trim(),
        top_k: topK,
        metadata_filters: metadataFilters,
        dense_weight: denseWeight,
        sparse_weight: sparseWeight,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Recherche impossible");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      <label className="label">
        Requête
        <input
          className="input"
          type="text"
          required
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ex: monuments à visiter à Paris"
        />
      </label>
      <div className="admin-form__row">
        <label className="label">
          Résultats
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(parsed)) {
                setTopK(5);
                return;
              }
              setTopK(Math.min(50, Math.max(1, parsed)));
            }}
          />
        </label>
        <label className="label">
          Poids dense
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            value={denseWeight}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value);
              setDenseWeight(Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
            }}
          />
        </label>
        <label className="label">
          Poids BM25
          <input
            className="input"
            type="number"
            step="0.1"
            min={0}
            value={sparseWeight}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value);
              setSparseWeight(Number.isNaN(parsed) ? 0 : Math.max(0, parsed));
            }}
          />
        </label>
      </div>
      <label className="label">
        Filtres de métadonnées (JSON)
        <textarea
          className="textarea"
          rows={3}
          value={metadataFiltersInput}
          onChange={(event) => setMetadataFiltersInput(event.target.value)}
          spellCheck={false}
          placeholder='{"category": "guide"}'
        />
      </label>
      <div className="admin-form__actions">
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Recherche…" : "Lancer la recherche"}
        </button>
      </div>
    </form>
  );
};
