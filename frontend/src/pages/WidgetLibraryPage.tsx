import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../auth";
import { useAppLayout } from "../components/AppLayout";
import { Modal } from "../components/Modal";
import { WidgetPreviewModal } from "../components/WidgetPreviewModal";
import { WidgetTemplateForm } from "../components/WidgetTemplateForm";
import { WidgetTemplateTable } from "../components/WidgetTemplateTable";
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
  const { token, user, logout } = useAuth();
  const { openSidebar, isDesktopLayout, isSidebarOpen } = useAppLayout();
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

  const badge = useMemo(() => {
    const widgetCountLabel = widgets.length
      ? ` · ${widgets.length} widget${widgets.length > 1 ? "s" : ""}`
      : "";
    return `${user?.email ?? "Administrateur"}${widgetCountLabel}`;
  }, [user?.email, widgets.length]);
  const showSidebarButton = !isDesktopLayout || !isSidebarOpen;

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
    <div className="app-content">
      <header className="app-content__header">
        <div className="app-content__leading">
          {showSidebarButton ? (
            <button
              className="button button--ghost app-content__menu-button"
              type="button"
              onClick={openSidebar}
            >
              Ouvrir le menu
            </button>
          ) : null}
          <div className="app-content__heading">
            <h1 className="app-content__title">Bibliothèque de widgets</h1>
            <p className="app-content__subtitle">
              Centralisez les widgets ChatKit prêts à être utilisés dans vos workflows agents.
            </p>
          </div>
        </div>
        <div className="app-content__toolbar">
          <span className="app-content__badge">{badge}</span>
          <div className="app-content__actions">
            <button className="button" type="button" onClick={() => setShowCreateModal(true)}>
              Nouveau widget
            </button>
          </div>
        </div>
      </header>

      {success ? <div className="alert alert--success">{success}</div> : null}
      {error ? <div className="alert alert--danger">{error}</div> : null}

      <div className="admin-grid">
        <section className="admin-card">
          <div>
            <h2 className="admin-card__title">Widgets disponibles</h2>
            <p className="admin-card__subtitle">
              Chaque entrée correspond à une définition JSON validée par le SDK ChatKit. Utilisez ces widgets comme sorties de vos agents dans le workflow builder.
            </p>
          </div>
          <WidgetTemplateTable
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
        </section>
        <section className="admin-card">
          <div>
            <h2 className="admin-card__title">Pourquoi des widgets ?</h2>
            <p className="admin-card__subtitle">
              Les widgets permettent d'afficher des réponses riches (cartes, tableaux, texte éditable) directement dans le chat. Les agents du workflow builder peuvent référencer un widget par son slug et diffuser cette mise en forme à l'utilisateur final.
            </p>
            <p className="admin-card__subtitle">
              Validez vos définitions JSON ici avant de les intégrer dans les modules ou outils de vos workflows agents.
            </p>
          </div>
        </section>
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
    </div>
  );
};

export default WidgetLibraryPage;
