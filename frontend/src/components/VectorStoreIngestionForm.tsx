import { ChangeEvent, FormEvent, useState } from "react";

import type { VectorStoreIngestionPayload } from "../utils/backend";
import { useI18n } from "../i18n";

type VectorStoreIngestionFormProps = {
  onSubmit: (payload: VectorStoreIngestionPayload) => Promise<void>;
  onCancel: () => void;
  defaultDocId?: string;
};

const stripJsonExtension = (value: string): string => value.replace(/\.json$/i, "");

export const VectorStoreIngestionForm = ({
  onSubmit,
  onCancel,
  defaultDocId = "",
}: VectorStoreIngestionFormProps) => {
  const { t } = useI18n();
  const [docId, setDocId] = useState(defaultDocId);
  const [documentInput, setDocumentInput] = useState("{}");
  const [metadataInput, setMetadataInput] = useState("{}");
  const [storeTitle, setStoreTitle] = useState("");
  const [storeMetadataInput, setStoreMetadataInput] = useState("");
  const [shouldCreateWorkflow, setShouldCreateWorkflow] = useState(false);
  const [workflowSlug, setWorkflowSlug] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowGraphInput, setWorkflowGraphInput] = useState("{}");
  const [workflowMarkActive, setWorkflowMarkActive] = useState(true);
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

    let workflowBlueprint: VectorStoreIngestionPayload["workflow_blueprint"] | undefined;
    if (shouldCreateWorkflow) {
      const slugValue = workflowSlug.trim();
      if (!slugValue) {
        setError(t("vectorStore.ingestion.errors.workflowSlugRequired"));
        return;
      }

      const nameValue = workflowName.trim();
      if (!nameValue) {
        setError(t("vectorStore.ingestion.errors.workflowNameRequired"));
        return;
      }

      let graphPayload: Record<string, unknown>;
      try {
        const parsedGraph = JSON.parse(workflowGraphInput) as unknown;
        if (!parsedGraph || typeof parsedGraph !== "object" || Array.isArray(parsedGraph)) {
          throw new Error("Le graphe doit être un objet JSON");
        }
        graphPayload = parsedGraph as Record<string, unknown>;
      } catch {
        setError(t("vectorStore.ingestion.errors.workflowGraphInvalid"));
        return;
      }

      workflowBlueprint = {
        slug: slugValue,
        display_name: nameValue,
        description: workflowDescription.trim() || undefined,
        graph: graphPayload,
        mark_active: workflowMarkActive,
      };
    }

    setSubmitting(true);
    try {
      const ingestionPayload: VectorStoreIngestionPayload = {
        doc_id: docId.trim(),
        document: documentPayload,
        metadata,
        store_title: storeTitle.trim() || undefined,
        store_metadata: storeMetadata ?? undefined,
      };
      if (workflowBlueprint) {
        ingestionPayload.workflow_blueprint = workflowBlueprint;
      }
      await onSubmit(ingestionPayload);
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
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={shouldCreateWorkflow}
          onChange={(event) => setShouldCreateWorkflow(event.target.checked)}
        />
        {t("vectorStore.ingestion.createWorkflow.label")}
      </label>
      {shouldCreateWorkflow ? (
        <>
          <label className="label">
            {t("vectorStore.ingestion.createWorkflow.slugLabel")}
            <input
              className="input"
              type="text"
              value={workflowSlug}
              onChange={(event) => setWorkflowSlug(event.target.value)}
            />
          </label>
          <label className="label">
            {t("vectorStore.ingestion.createWorkflow.nameLabel")}
            <input
              className="input"
              type="text"
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
            />
          </label>
          <label className="label">
            {t("vectorStore.ingestion.createWorkflow.descriptionLabel")}
            <textarea
              className="textarea"
              rows={2}
              value={workflowDescription}
              onChange={(event) => setWorkflowDescription(event.target.value)}
            />
          </label>
          <label className="label">
            {t("vectorStore.ingestion.createWorkflow.graphLabel")}
            <textarea
              className="textarea"
              rows={6}
              value={workflowGraphInput}
              onChange={(event) => setWorkflowGraphInput(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={workflowMarkActive}
              onChange={(event) => setWorkflowMarkActive(event.target.checked)}
            />
            {t("vectorStore.ingestion.createWorkflow.markActiveLabel")}
          </label>
        </>
      ) : null}
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
