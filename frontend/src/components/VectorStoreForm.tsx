import { FormEvent, useState } from "react";

import type { VectorStoreCreatePayload } from "../utils/backend";

type VectorStoreFormProps = {
  onSubmit: (payload: VectorStoreCreatePayload) => Promise<void>;
  onCancel: () => void;
};

export const VectorStoreForm = ({ onSubmit, onCancel }: VectorStoreFormProps) => {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metadataInput, setMetadataInput] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!slug.trim()) {
      setError("Le slug est obligatoire.");
      return;
    }

    let metadata: Record<string, unknown> = {};
    if (metadataInput.trim()) {
      try {
        metadata = JSON.parse(metadataInput) as Record<string, unknown>;
      } catch (parseError) {
        setError("Impossible de parser les métadonnées (JSON attendu).");
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        slug: slug.trim(),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
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
    <form className="admin-form" onSubmit={handleSubmit}>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      <label className="label">
        Slug (identifiant unique)
        <input
          className="input"
          type="text"
          required
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="ex: guides"
        />
      </label>
      <label className="label">
        Titre (optionnel)
        <input
          className="input"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Collection de guides"
        />
      </label>
      <label className="label">
        Description (optionnelle)
        <textarea
          className="textarea"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Brève description du contenu indexé"
        />
      </label>
      <label className="label">
        Métadonnées (JSON)
        <textarea
          className="textarea"
          rows={4}
          value={metadataInput}
          onChange={(event) => setMetadataInput(event.target.value)}
          spellCheck={false}
        />
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
