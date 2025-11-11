import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { VectorStoreSearchPayload } from "../utils/backend";
import { vectorStoreSearchFormSchema, type VectorStoreSearchFormData } from "../schemas/vectorStore";

type VectorStoreSearchFormProps = {
  onSubmit: (payload: VectorStoreSearchPayload) => Promise<void>;
};

export const VectorStoreSearchForm = ({ onSubmit }: VectorStoreSearchFormProps) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<VectorStoreSearchFormData>({
    resolver: zodResolver(vectorStoreSearchFormSchema),
    defaultValues: {
      query: "",
      topK: 5,
      metadataFiltersInput: "",
      denseWeight: 0.5,
      sparseWeight: 0.5,
    },
  });

  const onSubmitHandler = async (data: VectorStoreSearchFormData) => {
    let metadataFilters: Record<string, unknown> | undefined;
    if (data.metadataFiltersInput.trim()) {
      metadataFilters = JSON.parse(data.metadataFiltersInput) as Record<string, unknown>;
    }

    try {
      await onSubmit({
        query: data.query,
        top_k: data.topK,
        metadata_filters: metadataFilters,
        dense_weight: data.denseWeight,
        sparse_weight: data.sparseWeight,
      });
    } catch (submitError) {
      setError("root", {
        message: submitError instanceof Error ? submitError.message : "Recherche impossible",
      });
    }
  };

  return (
    <form className="admin-form" onSubmit={handleSubmit(onSubmitHandler)}>
      {errors.root && <div className="alert alert--danger">{errors.root.message}</div>}
      <label className="label">
        Requête
        <input
          className="input"
          type="text"
          {...register("query")}
          placeholder="ex: monuments à visiter à Paris"
        />
        {errors.query && <span className="error">{errors.query.message}</span>}
      </label>
      <div className="admin-form__row">
        <label className="label">
          Résultats
          <input
            className="input"
            type="number"
            {...register("topK", { valueAsNumber: true })}
          />
          {errors.topK && <span className="error">{errors.topK.message}</span>}
        </label>
        <label className="label">
          Poids dense
          <input
            className="input"
            type="number"
            step="0.1"
            {...register("denseWeight", { valueAsNumber: true })}
          />
          {errors.denseWeight && <span className="error">{errors.denseWeight.message}</span>}
        </label>
        <label className="label">
          Poids BM25
          <input
            className="input"
            type="number"
            step="0.1"
            {...register("sparseWeight", { valueAsNumber: true })}
          />
          {errors.sparseWeight && <span className="error">{errors.sparseWeight.message}</span>}
        </label>
      </div>
      <label className="label">
        Filtres de métadonnées (JSON)
        <textarea
          className="textarea"
          rows={3}
          {...register("metadataFiltersInput")}
          spellCheck={false}
          placeholder='{"category": "guide"}'
        />
        {errors.metadataFiltersInput && <span className="error">{errors.metadataFiltersInput.message}</span>}
      </label>
      <div className="admin-form__actions">
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Recherche…" : "Lancer la recherche"}
        </button>
      </div>
    </form>
  );
};
