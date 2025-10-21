import { ChangeEvent, FormEvent, useState } from "react";

import type { VectorStoreIngestionPayload } from "../utils/backend";

type VectorStoreIngestionFormProps = {
  onSubmit: (payload: VectorStoreIngestionPayload) => Promise<void>;
  onCancel: () => void;
  defaultDocId?: string;
  embeddingsEnabledByDefault?: boolean;
};

const stripJsonExtension = (value: string): string => value.replace(/\.json$/i, "");

export const VectorStoreIngestionForm = ({
  onSubmit,
  onCancel,
  defaultDocId = "",
  embeddingsEnabledByDefault = true,
}: VectorStoreIngestionFormProps) => {
  const [docId, setDocId] = useState(defaultDocId);
  const [documentInput, setDocumentInput] = useState("{}");
  const [metadataInput, setMetadataInput] = useState("{}");
  const [storeTitle, setStoreTitle] = useState("");
  const [storeMetadataInput, setStoreMetadataInput] = useState("");
  const [embeddingStrategy, setEmbeddingStrategy] = useState<"inherit" | "enabled" | "disabled">("inherit");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setDocumentInput(content);
      if (!docId) {
        setDocId(stripJsonExtension(file.name));
      }
    } catch (fileError) {
      setError(
        fileError instanceof Error ? fileError.message : "Impossible de lire le fichier JSON",
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!docId.trim()) {
      setError("Un identifiant de document est requis.");
      return;
    }

    let documentPayload: Record<string, unknown>;
    try {
      documentPayload = JSON.parse(documentInput) as Record<string, unknown>;
    } catch (parseError) {
      setError("Le document JSON est invalide.");
      return;
    }

    let metadata: Record<string, unknown> = {};
    if (metadataInput.trim()) {
      try {
        metadata = JSON.parse(metadataInput) as Record<string, unknown>;
      } catch {
        setError("Les métadonnées du document doivent être un JSON valide.");
        return;
      }
    }

    let storeMetadata: Record<string, unknown> | undefined;
    if (storeMetadataInput.trim()) {
      try {
        storeMetadata = JSON.parse(storeMetadataInput) as Record<string, unknown>;
      } catch {
        setError("Les métadonnées du store doivent être un JSON valide.");
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        doc_id: docId.trim(),
        document: documentPayload,
        metadata,
        store_title: storeTitle.trim() || undefined,
        store_metadata: storeMetadata ?? undefined,
        generate_embeddings:
          embeddingStrategy === "inherit"
            ? undefined
            : embeddingStrategy === "enabled",
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Échec de l'ingestion du document",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      <label className="label">
        Fichier JSON
        <input className="input" type="file" accept="application/json,.json" onChange={handleFileChange} />
      </label>
      <label className="label">
        Identifiant du document
        <input
          className="input"
          type="text"
          required
          value={docId}
          onChange={(event) => setDocId(event.target.value)}
          placeholder="paris-guide"
        />
      </label>
      <label className="label">
        Document JSON
        <textarea
          className="textarea"
          rows={8}
          value={documentInput}
          onChange={(event) => setDocumentInput(event.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="label">
        Métadonnées du document (JSON)
        <textarea
          className="textarea"
          rows={4}
          value={metadataInput}
          onChange={(event) => setMetadataInput(event.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="label">
        Génération d'embeddings
        <select
          className="input"
          value={embeddingStrategy}
          onChange={(event) => setEmbeddingStrategy(event.target.value as "inherit" | "enabled" | "disabled")}
        >
          <option value="inherit">Respecter la configuration du store ({embeddingsEnabledByDefault ? "activés" : "désactivés"})</option>
          <option value="enabled">Forcer l'activation pour ce document</option>
          <option value="disabled">Forcer la désactivation pour ce document</option>
        </select>
      </label>
      <p className="admin-card__subtitle" style={{ marginTop: "-0.25rem" }}>
        Cette option permet de surcharger ponctuellement la stratégie sans modifier le magasin dans ChatKit.
      </p>
      <details className="accordion">
        <summary>Mettre à jour les métadonnées du store (optionnel)</summary>
        <label className="label">
          Nouveau titre
          <input
            className="input"
            type="text"
            value={storeTitle}
            onChange={(event) => setStoreTitle(event.target.value)}
            placeholder="Titre affiché côté ChatKit"
          />
        </label>
        <label className="label">
          Métadonnées du store (JSON)
          <textarea
            className="textarea"
            rows={3}
            value={storeMetadataInput}
            onChange={(event) => setStoreMetadataInput(event.target.value)}
            spellCheck={false}
          />
        </label>
      </details>
      <div className="admin-form__actions">
        <button className="button button--subtle" type="button" onClick={onCancel} disabled={isSubmitting}>
          Annuler
        </button>
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Ingestion…" : "Ingestion"}
        </button>
      </div>
    </form>
  );
};
