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
    <form className="flex flex-col gap-6" onSubmit={rhfHandleSubmit(handleSubmit)}>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="form-group">
        <label className="form-label">Fichier JSON</label>
        <input className="input" type="file" accept="application/json,.json" onChange={handleFileChange} />
      </div>
      <div className="form-group">
        <label className="form-label">Identifiant du document</label>
        <input
          className="input"
          type="text"
          {...register("docId")}
          placeholder="paris-guide"
        />
        {formErrors.docId && <span className="form-error">{formErrors.docId.message}</span>}
      </div>
      <div className="form-group">
        <label className="form-label">Document JSON</label>
        <textarea
          className="textarea"
          rows={8}
          {...register("documentInput")}
          spellCheck={false}
        />
        {formErrors.documentInput && <span className="form-error">{formErrors.documentInput.message}</span>}
      </div>
      <div className="form-group">
        <label className="form-label">Métadonnées du document (JSON)</label>
        <textarea
          className="textarea"
          rows={4}
          {...register("metadataInput")}
          spellCheck={false}
        />
        {formErrors.metadataInput && <span className="form-error">{formErrors.metadataInput.message}</span>}
      </div>
      <details className="accordion-item">
        <summary className="accordion-trigger cursor-pointer">Mettre à jour les métadonnées du store (optionnel)</summary>
        <div className="accordion-content flex flex-col gap-6">
          <div className="form-group">
            <label className="form-label">Nouveau titre</label>
            <input
              className="input"
              type="text"
              {...register("storeTitle")}
              placeholder="Titre affiché côté ChatKit"
            />
            {formErrors.storeTitle && <span className="form-error">{formErrors.storeTitle.message}</span>}
          </div>
          <div className="form-group">
            <label className="form-label">Métadonnées du store (JSON)</label>
            <textarea
              className="textarea"
              rows={3}
              {...register("storeMetadataInput")}
              spellCheck={false}
            />
            {formErrors.storeMetadataInput && <span className="form-error">{formErrors.storeMetadataInput.message}</span>}
          </div>
        </div>
      </details>
      <div className="flex items-center justify-end gap-3">
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
          Annuler
        </button>
        <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Ingestion…" : "Ingestion"}
        </button>
      </div>
    </form>
  );
};
