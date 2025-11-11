import { ChangeEvent, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { VectorStoreIngestionPayload } from "../utils/backend";
import { vectorStoreIngestionFormSchema, type VectorStoreIngestionFormData } from "../schemas/vectorStore";

type VectorStoreIngestionFormProps = {
  onSubmit: (payload: VectorStoreIngestionPayload) => Promise<void>;
  onCancel: () => void;
  defaultDocId?: string;
  defaultDocument?: Record<string, unknown> | null;
  defaultMetadata?: Record<string, unknown> | null;
};

const stripJsonExtension = (value: string): string => value.replace(/\.json$/i, "");

export const VectorStoreIngestionForm = ({
  onSubmit,
  onCancel,
  defaultDocId = "",
  defaultDocument = null,
  defaultMetadata = null,
}: VectorStoreIngestionFormProps) => {
  const {
    register,
    handleSubmit: rhfHandleSubmit,
    formState: { errors: formErrors, isSubmitting },
    setValue,
    watch,
    setError: setFormError,
  } = useForm<VectorStoreIngestionFormData>({
    resolver: zodResolver(vectorStoreIngestionFormSchema),
    defaultValues: {
      docId: defaultDocId,
      documentInput: defaultDocument ? JSON.stringify(defaultDocument, null, 2) : "{}",
      metadataInput: defaultMetadata ? JSON.stringify(defaultMetadata, null, 2) : "{}",
      storeTitle: "",
      storeMetadataInput: "",
    },
  });

  const [error, setError] = useState<string | null>(null);
  const docId = watch("docId");

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setValue("documentInput", content);
      if (!docId) {
        setValue("docId", stripJsonExtension(file.name));
      }
    } catch (fileError) {
      setError(
        fileError instanceof Error ? fileError.message : "Impossible de lire le fichier JSON",
      );
    }
  };

  const handleSubmit = async (data: VectorStoreIngestionFormData) => {
    setError(null);

    let documentPayload: Record<string, unknown>;
    try {
      documentPayload = JSON.parse(data.documentInput) as Record<string, unknown>;
    } catch (parseError) {
      setError("Le document JSON est invalide.");
      return;
    }

    let metadata: Record<string, unknown> = {};
    if (data.metadataInput.trim()) {
      try {
        metadata = JSON.parse(data.metadataInput) as Record<string, unknown>;
      } catch {
        setError("Les métadonnées du document doivent être un JSON valide.");
        return;
      }
    }

    let storeMetadata: Record<string, unknown> | undefined;
    if (data.storeMetadataInput && data.storeMetadataInput.trim()) {
      try {
        storeMetadata = JSON.parse(data.storeMetadataInput) as Record<string, unknown>;
      } catch {
        setError("Les métadonnées du store doivent être un JSON valide.");
        return;
      }
    }

    try {
      const ingestionPayload: VectorStoreIngestionPayload = {
        doc_id: data.docId,
        document: documentPayload,
        metadata,
        store_title: data.storeTitle?.trim() || undefined,
        store_metadata: storeMetadata ?? undefined,
      };
      await onSubmit(ingestionPayload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Échec de l'ingestion du document",
      );
    }
  };

  return (
    <form className="admin-form" onSubmit={rhfHandleSubmit(handleSubmit)}>
      {error && <div className="alert alert--danger">{error}</div>}
      <label className="label">
        Fichier JSON
        <input className="input" type="file" accept="application/json,.json" onChange={handleFileChange} />
      </label>
      <label className="label">
        Identifiant du document
        <input
          className="input"
          type="text"
          {...register("docId")}
          placeholder="paris-guide"
        />
        {formErrors.docId && <span className="error">{formErrors.docId.message}</span>}
      </label>
      <label className="label">
        Document JSON
        <textarea
          className="textarea"
          rows={8}
          {...register("documentInput")}
          spellCheck={false}
        />
        {formErrors.documentInput && <span className="error">{formErrors.documentInput.message}</span>}
      </label>
      <label className="label">
        Métadonnées du document (JSON)
        <textarea
          className="textarea"
          rows={4}
          {...register("metadataInput")}
          spellCheck={false}
        />
        {formErrors.metadataInput && <span className="error">{formErrors.metadataInput.message}</span>}
      </label>
      <details className="accordion">
        <summary>Mettre à jour les métadonnées du store (optionnel)</summary>
        <label className="label">
          Nouveau titre
          <input
            className="input"
            type="text"
            {...register("storeTitle")}
            placeholder="Titre affiché côté ChatKit"
          />
          {formErrors.storeTitle && <span className="error">{formErrors.storeTitle.message}</span>}
        </label>
        <label className="label">
          Métadonnées du store (JSON)
          <textarea
            className="textarea"
            rows={3}
            {...register("storeMetadataInput")}
            spellCheck={false}
          />
          {formErrors.storeMetadataInput && <span className="error">{formErrors.storeMetadataInput.message}</span>}
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
