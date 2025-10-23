import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { VectorStoreDocumentsTable } from "../components/VectorStoreDocumentsTable";
import { VectorStoreForm } from "../components/VectorStoreForm";
import { VectorStoreIngestionForm } from "../components/VectorStoreIngestionForm";
import { VectorStoreSearchForm } from "../components/VectorStoreSearchForm";
import { VectorStoreSearchResults } from "../components/VectorStoreSearchResults";
import { VectorStoreTable } from "../components/VectorStoreTable";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import { useI18n } from "../i18n";
import {
  VectorStoreDocument,
  VectorStoreDocumentDetail,
  VectorStoreSearchPayload,
  VectorStoreSearchResult,
  VectorStoreSummary,
  WORKFLOW_VECTOR_STORE_SLUG,
  isUnauthorizedError,
  vectorStoreApi,
} from "../utils/backend";

type BaseDocumentDefaults = {
  docId: string;
  document: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractBaseDocumentDefaults = (
  metadata: Record<string, unknown>,
): BaseDocumentDefaults | null => {
  const baseDocument = metadata.base_document;
  if (!isPlainRecord(baseDocument)) {
    return null;
  }

  const docIdRaw = baseDocument.doc_id;
  if (typeof docIdRaw !== "string" || !docIdRaw.trim()) {
    return null;
  }

  const documentValue = baseDocument.document;
  if (!isPlainRecord(documentValue)) {
    return null;
  }

  const metadataValue = baseDocument.metadata;
  const metadataRecord = isPlainRecord(metadataValue) ? metadataValue : undefined;

  return {
    docId: docIdRaw.trim(),
    document: documentValue,
    metadata: metadataRecord,
  };
};

const sortStores = (stores: VectorStoreSummary[]): VectorStoreSummary[] =>
  [...stores].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

export const VectorStoresPage = () => {
  const { token, logout } = useAuth();
  const { t } = useI18n();
  const [stores, setStores] = useState<VectorStoreSummary[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ReactNode>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedStore, setSelectedStore] = useState<VectorStoreSummary | null>(null);
  const [showIngestionModal, setShowIngestionModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchResults, setSearchResults] = useState<VectorStoreSearchResult[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [documentPreview, setDocumentPreview] = useState<VectorStoreDocumentDetail | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);
  const [documents, setDocuments] = useState<VectorStoreDocument[]>([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  const ingestionDefaults =
    selectedStore && selectedStore.slug === WORKFLOW_VECTOR_STORE_SLUG
      ? extractBaseDocumentDefaults(selectedStore.metadata)
      : null;

  const refreshStores = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await vectorStoreApi.listStores(token);
      setStores(sortStores(data));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Impossible de récupérer les vector stores");
    } finally {
      setLoading(false);
    }
  }, [logout, token]);

  const loadDocuments = useCallback(
    async (slug: string) => {
      if (!token) {
        return;
      }
      setDocumentsLoading(true);
      setDocumentsError(null);
      try {
        const data = await vectorStoreApi.listDocuments(token, slug);
        setDocuments(data);
      } catch (err) {
        if (isUnauthorizedError(err)) {
          logout();
          setShowDocumentsModal(false);
          setError("Session expirée, veuillez vous reconnecter.");
          return;
        }
        setDocumentsError(
          err instanceof Error ? err.message : "Impossible de récupérer les documents",
        );
      } finally {
        setDocumentsLoading(false);
      }
    },
    [logout, token],
  );

  useEffect(() => {
    if (!token) {
      setStores([]);
      setLoading(false);
      return;
    }
    void refreshStores();
  }, [refreshStores, token]);

  const handleCreateStore = async (payload: Parameters<typeof vectorStoreApi.createStore>[1]) => {
    if (!token) {
      throw new Error("Authentification requise");
    }
    try {
      const created = await vectorStoreApi.createStore(token, payload);
      setStores((prev) => sortStores([...prev, created]));
      setSuccess(`Vector store « ${created.slug} » créé avec succès.`);
      setShowCreateModal(false);
    } catch (err) {
      setSuccess(null);
      if (isUnauthorizedError(err)) {
        logout();
        setShowCreateModal(false);
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      throw err instanceof Error ? err : new Error("Impossible de créer le vector store");
    }
  };

  const handleDeleteStore = async (store: VectorStoreSummary) => {
    if (!token) {
      return;
    }
    if (!window.confirm(`Supprimer le vector store « ${store.slug} » ?`)) {
      return;
    }
    try {
      await vectorStoreApi.deleteStore(token, store.slug);
      setStores((prev) => prev.filter((item) => item.slug !== store.slug));
      setSuccess(`Vector store « ${store.slug} » supprimé.`);
    } catch (err) {
      setSuccess(null);
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(err instanceof Error ? err.message : "Suppression impossible");
    }
  };

  const openIngestionModal = (store: VectorStoreSummary) => {
    setSelectedStore(store);
    setShowIngestionModal(true);
    setDocumentPreview(null);
    setDocumentError(null);
  };

  const openSearchModal = (store: VectorStoreSummary) => {
    setSelectedStore(store);
    setShowSearchModal(true);
    setSearchResults([]);
    setHasSearched(false);
    setDocumentPreview(null);
    setDocumentError(null);
  };

  const openDocumentsModal = (store: VectorStoreSummary) => {
    setSelectedStore(store);
    setShowDocumentsModal(true);
    setDocuments([]);
    setDocumentsError(null);
    setDocumentPreview(null);
    setDocumentError(null);
    void loadDocuments(store.slug);
  };

  const handleIngestion = async (
    payload: Parameters<typeof vectorStoreApi.ingestDocument>[2],
  ) => {
    if (!token || !selectedStore) {
      throw new Error("Sélection invalide");
    }
    try {
      const document = await vectorStoreApi.ingestDocument(token, selectedStore.slug, payload);
      const pluralSuffix = document.chunk_count > 1 ? "s" : "";
      const baseMessage = t("vectorStore.ingestion.success.document", {
        docId: document.doc_id,
        chunkCount: document.chunk_count,
        pluralSuffix,
      });
      setSuccess(baseMessage);
      setShowIngestionModal(false);
      await refreshStores();
    } catch (err) {
      setSuccess(null);
      if (isUnauthorizedError(err)) {
        logout();
        setShowIngestionModal(false);
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      throw err instanceof Error ? err : new Error("Ingestion impossible");
    }
  };

  const handleSearch = async (payload: VectorStoreSearchPayload) => {
    if (!token || !selectedStore) {
      throw new Error("Sélection invalide");
    }
    setSearching(true);
    setSuccess(null);
    setDocumentPreview(null);
    try {
      const results = await vectorStoreApi.search(token, selectedStore.slug, payload);
      setSearchResults(results);
      setHasSearched(true);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setShowSearchModal(false);
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      throw err instanceof Error ? err : new Error("Recherche impossible");
    } finally {
      setSearching(false);
    }
  };

  const handleInspectResult = async (result: VectorStoreSearchResult) => {
    if (!token || !selectedStore) {
      return;
    }
    setDocumentError(null);
    try {
      const detail = await vectorStoreApi.getDocument(token, selectedStore.slug, result.doc_id);
      setDocumentPreview(detail);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setShowSearchModal(false);
        return;
      }
      setDocumentError(err instanceof Error ? err.message : "Impossible de récupérer le document");
    }
  };

  const handleInspectDocument = async (document: VectorStoreDocument) => {
    if (!token || !selectedStore) {
      return;
    }
    setDocumentError(null);
    try {
      const detail = await vectorStoreApi.getDocument(token, selectedStore.slug, document.doc_id);
      setDocumentPreview(detail);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setShowDocumentsModal(false);
        return;
      }
      setDocumentError(err instanceof Error ? err.message : "Impossible de récupérer le document");
    }
  };

  const handleDeleteDocument = async (document: VectorStoreDocument) => {
    if (!token || !selectedStore) {
      return;
    }
    if (!window.confirm(`Supprimer le document « ${document.doc_id} » ?`)) {
      return;
    }
    setDocumentsError(null);
    try {
      await vectorStoreApi.deleteDocument(token, selectedStore.slug, document.doc_id);
      setDocuments((prev) => prev.filter((item) => item.doc_id !== document.doc_id));
      setDocumentPreview((current) => (current?.doc_id === document.doc_id ? null : current));
      setSuccess(`Document « ${document.doc_id} » supprimé.`);
      await refreshStores();
    } catch (err) {
      setSuccess(null);
      if (isUnauthorizedError(err)) {
        logout();
        setShowDocumentsModal(false);
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setDocumentsError(err instanceof Error ? err.message : "Suppression impossible");
    }
  };

  return (
    <ManagementPageLayout
      actions={
        <button
          className="management-header__icon-button"
          type="button"
          aria-label="Créer un vector store"
          onClick={() => setShowCreateModal(true)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 4v12M4 10h12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      }
    >
      {success ? <div className="alert alert--success">{success}</div> : null}
      {error ? <div className="alert alert--danger">{error}</div> : null}

      <VectorStoreTable
        stores={stores}
        isLoading={isLoading}
        onIngest={openIngestionModal}
        onSearch={openSearchModal}
        onDocuments={openDocumentsModal}
        onDelete={handleDeleteStore}
      />

      {showCreateModal ? (
        <Modal title="Créer un vector store" onClose={() => setShowCreateModal(false)}>
          <VectorStoreForm onSubmit={handleCreateStore} onCancel={() => setShowCreateModal(false)} />
        </Modal>
      ) : null}

      {showIngestionModal && selectedStore ? (
        <Modal title={`Ingestion dans « ${selectedStore.slug} »`} onClose={() => setShowIngestionModal(false)} size="lg">
          <VectorStoreIngestionForm
            key={selectedStore.slug}
            onSubmit={handleIngestion}
            onCancel={() => setShowIngestionModal(false)}
            defaultDocId={ingestionDefaults?.docId ?? ""}
            defaultDocument={ingestionDefaults?.document ?? null}
            defaultMetadata={ingestionDefaults?.metadata ?? null}
          />
        </Modal>
      ) : null}

      {showSearchModal && selectedStore ? (
        <Modal title={`Tester une requête — ${selectedStore.slug}`} onClose={() => setShowSearchModal(false)} size="lg">
          <VectorStoreSearchForm onSubmit={handleSearch} />
          {isSearching ? (
            <p className="admin-card__subtitle">Recherche en cours…</p>
          ) : hasSearched ? (
            <VectorStoreSearchResults results={searchResults} onInspect={handleInspectResult} />
          ) : (
            <p className="admin-card__subtitle">
              Soumettez une requête pour afficher les résultats issus du vector store.
            </p>
          )}
          {documentError ? <div className="alert alert--danger">{documentError}</div> : null}
          {documentPreview ? (
            <div className="vector-store__preview">
              <h3>Document « {documentPreview.doc_id} »</h3>
              <p className="admin-card__subtitle">
                {documentPreview.chunk_count} segment{documentPreview.chunk_count > 1 ? "s" : ""} indexé{documentPreview.chunk_count > 1 ? "s" : ""}.
              </p>
              <pre className="code-block">{JSON.stringify(documentPreview.document, null, 2)}</pre>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {showDocumentsModal && selectedStore ? (
        <Modal title={`Documents — ${selectedStore.slug}`} onClose={() => setShowDocumentsModal(false)} size="lg">
          <div className="admin-table__actions" style={{ justifyContent: "flex-end", marginBottom: "1rem" }}>
            <button className="button button--ghost button--sm" type="button" onClick={() => void loadDocuments(selectedStore.slug)}>
              Actualiser
            </button>
          </div>
          {documentsError ? <div className="alert alert--danger">{documentsError}</div> : null}
          <VectorStoreDocumentsTable
            documents={documents}
            isLoading={documentsLoading}
            onInspect={handleInspectDocument}
            onDelete={handleDeleteDocument}
          />
          {documentError ? <div className="alert alert--danger">{documentError}</div> : null}
          {documentPreview ? (
            <div className="vector-store__preview">
              <h3>Document « {documentPreview.doc_id} »</h3>
              <p className="admin-card__subtitle">
                {documentPreview.chunk_count} segment{documentPreview.chunk_count > 1 ? "s" : ""} indexé{documentPreview.chunk_count > 1 ? "s" : ""}.
              </p>
              <pre className="code-block">{JSON.stringify(documentPreview.document, null, 2)}</pre>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </ManagementPageLayout>
  );
}

export default VectorStoresPage;
