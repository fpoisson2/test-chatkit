import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { VectorStoreCreatePayload } from "../utils/backend";
import { vectorStoreFormSchema, type VectorStoreFormData } from "../schemas/vectorStore";

type VectorStoreFormProps = {
  onSubmit: (payload: VectorStoreCreatePayload) => Promise<void>;
  onCancel: () => void;
};

export const VectorStoreForm = ({ onSubmit, onCancel }: VectorStoreFormProps) => {
  const {
    register,
    handleSubmit: handleFormSubmit,
    formState: { errors: formErrors },
  } = useForm<VectorStoreFormData>({
    resolver: zodResolver(vectorStoreFormSchema),
    defaultValues: {
      slug: "",
      title: "",
      description: "",
      metadataInput: "{}",
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const handleSubmit = async (data: VectorStoreFormData) => {
    setError(null);

    let metadata: Record<string, unknown> = {};
    if (data.metadataInput?.trim()) {
      try {
        metadata = JSON.parse(data.metadataInput) as Record<string, unknown>;
      } catch (parseError) {
        setError("Impossible de parser les métadonnées (JSON attendu).");
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        slug: data.slug.trim(),
        title: data.title?.trim() || undefined,
        description: data.description?.trim() || undefined,
        metadata,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Échec de la création du vector store",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={handleFormSubmit(handleSubmit)}>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-group">
        <label className="form-label">Slug (identifiant unique)</label>
        <input
          className="input"
          type="text"
          {...register("slug")}
          placeholder="ex: guides"
        />
        {formErrors.slug && (
          <span className="form-error">
            {formErrors.slug.message}
          </span>
        )}
      </div>
      <div className="form-group">
        <label className="form-label">Titre (optionnel)</label>
        <input
          className="input"
          type="text"
          {...register("title")}
          placeholder="Collection de guides"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Description (optionnelle)</label>
        <textarea
          className="textarea"
          rows={3}
          {...register("description")}
          placeholder="Brève description du contenu indexé"
        />
      </div>
      <div className="form-group">
        <label className="form-label">Métadonnées (JSON)</label>
        <textarea
          className="textarea"
          rows={4}
          {...register("metadataInput")}
          spellCheck={false}
        />
        {formErrors.metadataInput && (
          <span className="form-error">
            {formErrors.metadataInput.message}
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
          Annuler
        </button>
        <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Création…" : "Créer"}
        </button>
      </div>
    </form>
  );
};
