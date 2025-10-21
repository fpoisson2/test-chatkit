import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { WidgetPreviewModal } from "../components/WidgetPreviewModal";
import { WidgetTemplateForm } from "../components/WidgetTemplateForm";
import { WidgetTemplateGallery } from "../components/WidgetTemplateGallery";
import { ManagementPageLayout } from "../components/ManagementPageLayout";
import {
  ApiError,
  isUnauthorizedError,
  widgetLibraryApi,
  type WidgetTemplate,
} from "../utils/backend";

type WidgetFormPayload = {
  slug: string;
  title: string | null;
  description: string | null;
  definition: Record<string, unknown>;
};

const sortWidgets = (widgets: WidgetTemplate[]): WidgetTemplate[] =>
  [...widgets].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

export const WidgetLibraryPage = () => {
  const { token, logout } = useAuth();
  const [widgets, setWidgets] = useState<WidgetTemplate[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingWidget, setEditingWidget] = useState<WidgetTemplate | null>(null);
  const [previewData, setPreviewData] = useState<{
    title: string;
    subtitle?: string | null;
    definition: Record<string, unknown>;
  } | null>(null);

  const refreshWidgets = useCallback(async () => {
    if (!token) {
      setWidgets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await widgetLibraryApi.listWidgets(token);
      setWidgets(sortWidgets(data));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        setError("Session expirée, veuillez vous reconnecter.");
        return;
      }
      setError(
        err instanceof Error ? err.message : "Impossible de récupérer la bibliothèque de widgets",
      );
    } finally {
      setLoading(false);
    }
  }, [logout, token]);

  useEffect(() => {
    if (!token) {
      setWidgets([]);
      setLoading(false);
      return;
    }
    void refreshWidgets();
  }, [refreshWidgets, token]);

  const handleCreate = async (payload: WidgetFormPayload) => {
    if (!token) {
      throw new Error("Authentification requise");
    }
    try {
      const created = await widgetLibraryApi.createWidget(token, {
        slug: payload.slug,
        title: payload.title ?? undefined,
        description: payload.description ?? undefined,
        definition: payload.definition,
      });
      setWidgets((prev) => sortWidgets([...prev, created]));
      setShowCreateModal(false);
      setSuccess(`Widget « ${created.slug} » créé avec succès.`);
    } catch (err) {
      setSuccess(null);
      if (isUnauthorizedError(err)) {
        logout();
        setShowCreateModal(false);
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      throw err instanceof Error ? err : new Error("Impossible de créer le widget");
    }
  };

  const handleUpdate = async (payload: WidgetFormPayload) => {
    if (!token || !editingWidget) {
      throw new Error("Sélection de widget invalide");
    }
    try {
      const updated = await widgetLibraryApi.updateWidget(token, editingWidget.slug, {
        title: payload.title ?? undefined,
        description: payload.description ?? undefined,
        definition: payload.definition,
      });
      setWidgets((prev) =>
        sortWidgets(prev.map((widget) => (widget.slug === updated.slug ? updated : widget))),
      );
      setEditingWidget(null);
      setSuccess(`Widget « ${updated.slug} » mis à jour.`);
    } catch (err) {
      setSuccess(null);
      if (isUnauthorizedError(err)) {
        logout();
        setEditingWidget(null);
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      throw err instanceof Error ? err : new Error("Impossible de mettre à jour le widget");
    }
  };

  const handleDelete = async (widget: WidgetTemplate) => {
    if (!token) {
      return;
    }
    if (!window.confirm(`Supprimer le widget « ${widget.slug} » ?`)) {
      return;
    }
    try {
      await widgetLibraryApi.deleteWidget(token, widget.slug);
      setWidgets((prev) => prev.filter((item) => item.slug !== widget.slug));
      setSuccess(`Widget « ${widget.slug} » supprimé.`);
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

  const handlePreviewDefinition = async (
    definition: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    if (!token) {
      throw new Error("Authentification requise");
    }
    try {
      return await widgetLibraryApi.previewWidget(token, definition);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        logout();
        throw new Error("Session expirée, veuillez vous reconnecter.");
      }
      if (err instanceof ApiError) {
        throw err;
      }
      throw err instanceof Error
        ? err
        : new Error("Impossible de valider la définition du widget");
    }
  };

  return (
    <ManagementPageLayout
      actions={
        <button
          type="button"
          className="management-header__icon-button"
          aria-label="Créer un nouveau widget"
          title="Nouveau widget"
          onClick={() => setShowCreateModal(true)}
        >
          <svg aria-hidden={true} width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      }
    >
      {success ? <div className="alert alert--success">{success}</div> : null}
      {error ? <div className="alert alert--danger">{error}</div> : null}

      <div className="widget-library">
        <WidgetTemplateGallery
          widgets={widgets}
          isLoading={isLoading}
          onPreview={(widget) =>
            setPreviewData({
              title: `Widget « ${widget.title ?? widget.slug} »`,
              subtitle: widget.slug,
              definition: widget.definition,
            })
          }
          onEdit={(widget) => setEditingWidget(widget)}
          onDelete={handleDelete}
        />
      </div>

      {showCreateModal ? (
        <Modal title="Créer un widget" onClose={() => setShowCreateModal(false)} size="lg">
          <WidgetTemplateForm
            mode="create"
            onSubmit={handleCreate}
            onCancel={() => setShowCreateModal(false)}
            onPreview={handlePreviewDefinition}
          />
        </Modal>
      ) : null}

      {editingWidget ? (
        <Modal title={`Modifier le widget « ${editingWidget.slug} »`} onClose={() => setEditingWidget(null)} size="lg">
          <WidgetTemplateForm
            mode="edit"
            initialValue={editingWidget}
            onSubmit={handleUpdate}
            onCancel={() => setEditingWidget(null)}
            onPreview={handlePreviewDefinition}
          />
        </Modal>
      ) : null}

      {previewData ? (
        <WidgetPreviewModal
          title={previewData.title}
          subtitle={previewData.subtitle}
          definition={previewData.definition}
          onClose={() => setPreviewData(null)}
        />
      ) : null}
    </ManagementPageLayout>
  );
};

export default WidgetLibraryPage;
