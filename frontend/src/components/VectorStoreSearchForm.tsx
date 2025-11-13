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
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmitHandler)}>
      {errors.root && <div className="alert alert-danger">{errors.root.message}</div>}
      <div className="form-group">
        <label className="form-label">Requête</label>
        <input
          className="input"
          type="text"
          {...register("query")}
          placeholder="ex: monuments à visiter à Paris"
        />
        {errors.query && <span className="form-error">{errors.query.message}</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="form-group">
          <label className="form-label">Résultats</label>
          <input
            className="input"
            type="number"
            {...register("topK", { valueAsNumber: true })}
          />
          {errors.topK && <span className="form-error">{errors.topK.message}</span>}
        </div>
        <div className="form-group">
          <label className="form-label">Poids dense</label>
          <input
            className="input"
            type="number"
            step="0.1"
            {...register("denseWeight", { valueAsNumber: true })}
          />
          {errors.denseWeight && <span className="form-error">{errors.denseWeight.message}</span>}
        </div>
        <div className="form-group">
          <label className="form-label">Poids BM25</label>
          <input
            className="input"
            type="number"
            step="0.1"
            {...register("sparseWeight", { valueAsNumber: true })}
          />
          {errors.sparseWeight && <span className="form-error">{errors.sparseWeight.message}</span>}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Filtres de métadonnées (JSON)</label>
        <textarea
          className="textarea"
          rows={3}
          {...register("metadataFiltersInput")}
          spellCheck={false}
          placeholder='{"category": "guide"}'
        />
        {errors.metadataFiltersInput && <span className="form-error">{errors.metadataFiltersInput.message}</span>}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Recherche…" : "Lancer la recherche"}
        </button>
      </div>
    </form>
  );
};
