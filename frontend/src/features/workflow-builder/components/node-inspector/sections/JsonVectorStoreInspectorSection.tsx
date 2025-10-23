import type { VectorStoreSummary } from "../../../../../utils/backend";
import type { VectorStoreNodeConfig } from "../../../types";
import { HelpTooltip } from "../components/HelpTooltip";
import styles from "../NodeInspector.module.css";

type JsonVectorStoreInspectorSectionProps = {
  nodeId: string;
  vectorStores: VectorStoreSummary[];
  vectorStoresLoading: boolean;
  vectorStoresError: string | null;
  vectorStoreNodeSlug: string;
  vectorStoreNodeDocIdExpression: string;
  vectorStoreNodeDocumentExpression: string;
  vectorStoreNodeMetadataExpression: string;
  vectorStoreNodeBlueprintExpression: string;
  vectorStoreNodeValidationMessages: string[];
  onVectorStoreNodeConfigChange: (
    nodeId: string,
    updates: Partial<VectorStoreNodeConfig>,
  ) => void;
};

export const JsonVectorStoreInspectorSection = ({
  nodeId,
  vectorStores,
  vectorStoresLoading,
  vectorStoresError,
  vectorStoreNodeSlug,
  vectorStoreNodeDocIdExpression,
  vectorStoreNodeDocumentExpression,
  vectorStoreNodeMetadataExpression,
  vectorStoreNodeBlueprintExpression,
  vectorStoreNodeValidationMessages,
  onVectorStoreNodeConfigChange,
}: JsonVectorStoreInspectorSectionProps) => (
  <>
    <p className={styles.nodeInspectorMutedTextSpaced}>
      Ce bloc enregistre le JSON produit par le bloc précédent dans le vector store sélectionné.
    </p>

    {vectorStoresError ? (
      <p className={styles.nodeInspectorErrorTextCompact}>{vectorStoresError}</p>
    ) : null}

    {vectorStoresLoading ? (
      <p className={styles.nodeInspectorMutedTextSpaced}>
        Chargement des vector stores…
      </p>
    ) : vectorStores.length === 0 ? (
      <p className={styles.nodeInspectorMutedTextSpaced}>
        Aucun vector store disponible. Créez-en un depuis l'onglet « Vector stores JSON ».
      </p>
    ) : (
      <label className={styles.nodeInspectorInlineField}>
        <span className={styles.nodeInspectorLabel}>
          Vector store cible
          <HelpTooltip label="Choisissez le magasin JSON dans lequel indexer la réponse structurée." />
        </span>
        <select
          value={vectorStoreNodeSlug}
          onChange={(event) =>
            onVectorStoreNodeConfigChange(nodeId, { vector_store_slug: event.target.value })
          }
        >
          <option value="">Sélectionnez un vector store…</option>
          {vectorStores.map((store) => (
            <option key={store.slug} value={store.slug}>
              {store.title?.trim() ? `${store.title} (${store.slug})` : store.slug}
            </option>
          ))}
        </select>
      </label>
    )}

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Expression de l'identifiant du document (facultatif)
        <HelpTooltip label="Laissez vide pour réutiliser la clé doc_id du JSON structuré ou générer un identifiant automatique." />
      </span>
      <input
        type="text"
        value={vectorStoreNodeDocIdExpression}
        onChange={(event) =>
          onVectorStoreNodeConfigChange(nodeId, { doc_id_expression: event.target.value })
        }
        placeholder="Ex. input.output_parsed.doc_id"
      />
    </label>

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Expression JSON à indexer (facultatif)
        <HelpTooltip label="Laissez vide pour indexer automatiquement la sortie structurée du bloc précédent." />
      </span>
      <input
        type="text"
        value={vectorStoreNodeDocumentExpression}
        onChange={(event) =>
          onVectorStoreNodeConfigChange(nodeId, { document_expression: event.target.value })
        }
        placeholder="Ex. input.output_parsed"
      />
    </label>

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Expression des métadonnées (facultatif)
        <HelpTooltip label="Retourne un objet JSON fusionné avec les métadonnées automatiques du workflow." />
      </span>
      <input
        type="text"
        value={vectorStoreNodeMetadataExpression}
        onChange={(event) =>
          onVectorStoreNodeConfigChange(nodeId, { metadata_expression: event.target.value })
        }
        placeholder='Ex. {"source": "workflow"}'
      />
    </label>

    <label className={styles.nodeInspectorField}>
      <span className={styles.nodeInspectorLabel}>
        Expression du blueprint de workflow (facultatif)
        <HelpTooltip label="Retourne un objet décrivant un workflow (slug, display_name, graph.nodes et graph.edges)." />
      </span>
      <input
        type="text"
        value={vectorStoreNodeBlueprintExpression}
        onChange={(event) =>
          onVectorStoreNodeConfigChange(nodeId, {
            workflow_blueprint_expression: event.target.value,
          })
        }
        placeholder="Ex. input.output_parsed.workflow_blueprint"
      />
    </label>

    {vectorStoreNodeValidationMessages.map((message, index) => (
      <p key={`vector-store-node-${index}`} className={styles.nodeInspectorErrorText}>
        {message}
      </p>
    ))}
  </>
);
