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
    <form className="admin-form" onSubmit={handleFormSubmit(handleSubmit)}>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      <label className="label">
        Slug (identifiant unique)
        <input
          className="input"
          type="text"
          {...register("slug")}
          placeholder="ex: guides"
        />
        {formErrors.slug && (
          <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
            {formErrors.slug.message}
          </span>
        )}
      </label>
      <label className="label">
        Titre (optionnel)
        <input
          className="input"
          type="text"
          {...register("title")}
          placeholder="Collection de guides"
        />
      </label>
      <label className="label">
        Description (optionnelle)
        <textarea
          className="textarea"
          rows={3}
          {...register("description")}
          placeholder="Brève description du contenu indexé"
        />
      </label>
      <label className="label">
        Métadonnées (JSON)
        <textarea
          className="textarea"
          rows={4}
          {...register("metadataInput")}
          spellCheck={false}
        />
        {formErrors.metadataInput && (
          <span className="error-message" style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.25rem', display: 'block' }}>
            {formErrors.metadataInput.message}
          </span>
        )}
      </label>
      <div className="admin-form__actions">
        <button className="button button--subtle" type="button" onClick={onCancel} disabled={isSubmitting}>
          Annuler
        </button>
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Création…" : "Créer"}
        </button>
      </div>
    </form>
  );
};
