import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Modal } from "../../components/Modal";
import { useI18n } from "../../i18n";
import { workflowsApi } from "../../utils/backend";
import type {
  WorkflowSharedUser,
  WorkflowSharePermission,
  WorkflowSummary,
} from "../../types/workflows";

type ShareWorkflowModalProps = {
  token: string | null;
  isOpen: boolean;
  workflow: WorkflowSummary | null;
  onClose: () => void;
  onSharesUpdated?: (workflow: WorkflowSummary) => void;
};

export const ShareWorkflowModal = ({
  token,
  isOpen,
  workflow,
  onClose,
  onSharesUpdated,
}: ShareWorkflowModalProps) => {
  const { t } = useI18n();
  const [sharedUsers, setSharedUsers] = useState<WorkflowSharedUser[]>([]);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<WorkflowSharePermission>("read");
  const [isLoading, setLoading] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load shared users when modal opens
  useEffect(() => {
    if (!isOpen) {
      setSharedUsers([]);
      setEmail("");
      setPermission("read");
      setLoading(false);
      setBusy(false);
      setError(null);
      setSuccess(null);
      return;
    }

    if (!token || !workflow) {
      return;
    }

    // Use the shared_with from the workflow object
    setSharedUsers(workflow.shared_with || []);
  }, [isOpen, token, workflow]);

  const handleShare = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      if (!token || !workflow || !email.trim()) {
        return;
      }

      setBusy(true);
      setError(null);
      setSuccess(null);

      try {
        const newUser = await workflowsApi.shareWorkflow(
          token,
          workflow.id,
          email.trim(),
          permission
        );
        setSharedUsers((prev) => [...prev, newUser]);
        setEmail("");
        setPermission("read");
        setSuccess(t("workflows.share.success"));

        // Notify parent of the update
        if (onSharesUpdated) {
          onSharesUpdated({
            ...workflow,
            shared_with: [...(workflow.shared_with || []), newUser],
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("workflows.share.errorGeneric");
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [token, workflow, email, permission, t, onSharesUpdated]
  );

  const handleUnshare = useCallback(
    async (userId: number) => {
      if (!token || !workflow) {
        return;
      }

      setBusy(true);
      setError(null);
      setSuccess(null);

      try {
        await workflowsApi.unshareWorkflow(token, workflow.id, userId);
        const updatedShares = sharedUsers.filter((u) => u.id !== userId);
        setSharedUsers(updatedShares);
        setSuccess(t("workflows.share.removed"));

        // Notify parent of the update
        if (onSharesUpdated) {
          onSharesUpdated({
            ...workflow,
            shared_with: updatedShares,
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("workflows.share.errorGeneric");
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [token, workflow, sharedUsers, t, onSharesUpdated]
  );

  const handlePermissionChange = useCallback(
    async (userId: number, newPermission: WorkflowSharePermission) => {
      if (!token || !workflow) {
        return;
      }

      setBusy(true);
      setError(null);
      setSuccess(null);

      try {
        const updatedUser = await workflowsApi.updateSharePermission(
          token,
          workflow.id,
          userId,
          newPermission
        );
        const updatedShares = sharedUsers.map((u) =>
          u.id === userId ? updatedUser : u
        );
        setSharedUsers(updatedShares);
        setSuccess(t("workflows.share.permissionUpdated"));

        // Notify parent of the update
        if (onSharesUpdated) {
          onSharesUpdated({
            ...workflow,
            shared_with: updatedShares,
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("workflows.share.errorGeneric");
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [token, workflow, sharedUsers, t, onSharesUpdated]
  );

  const modalTitle = workflow
    ? t("workflows.share.title", { name: workflow.display_name })
    : t("workflows.share.titleGeneric");

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="md">
      <div className="share-workflow-modal">
        {error && (
          <div className="share-workflow-modal__error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="share-workflow-modal__success" role="status">
            {success}
          </div>
        )}

        <form onSubmit={handleShare} className="share-workflow-modal__form">
          <div className="share-workflow-modal__input-group">
            <label htmlFor="share-email" className="share-workflow-modal__label">
              {t("workflows.share.emailLabel")}
            </label>
            <input
              id="share-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("workflows.share.emailPlaceholder")}
              className="share-workflow-modal__input"
              disabled={isBusy}
              required
            />
          </div>
          <div className="share-workflow-modal__input-group">
            <label
              htmlFor="share-permission"
              className="share-workflow-modal__label"
            >
              {t("workflows.share.permissionLabel")}
            </label>
            <select
              id="share-permission"
              value={permission}
              onChange={(e) =>
                setPermission(e.target.value as WorkflowSharePermission)
              }
              className="share-workflow-modal__select"
              disabled={isBusy}
            >
              <option value="read">{t("workflows.share.permissionRead")}</option>
              <option value="write">
                {t("workflows.share.permissionWrite")}
              </option>
            </select>
          </div>
          <button
            type="submit"
            className="share-workflow-modal__button share-workflow-modal__button--primary"
            disabled={isBusy || !email.trim()}
          >
            {isBusy ? t("workflows.share.sharing") : t("workflows.share.shareButton")}
          </button>
        </form>

        {sharedUsers.length > 0 && (
          <div className="share-workflow-modal__list">
            <h4 className="share-workflow-modal__list-title">
              {t("workflows.share.sharedWith")}
            </h4>
            <ul className="share-workflow-modal__users">
              {sharedUsers.map((user) => (
                <li key={user.id} className="share-workflow-modal__user">
                  <span className="share-workflow-modal__user-email">
                    {user.email}
                  </span>
                  <select
                    value={user.permission}
                    onChange={(e) =>
                      handlePermissionChange(
                        user.id,
                        e.target.value as WorkflowSharePermission
                      )
                    }
                    className="share-workflow-modal__select share-workflow-modal__select--small"
                    disabled={isBusy}
                    aria-label={t("workflows.share.changePermission", {
                      email: user.email,
                    })}
                  >
                    <option value="read">
                      {t("workflows.share.permissionRead")}
                    </option>
                    <option value="write">
                      {t("workflows.share.permissionWrite")}
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleUnshare(user.id)}
                    className="share-workflow-modal__button share-workflow-modal__button--danger"
                    disabled={isBusy}
                    aria-label={t("workflows.share.removeAccess", {
                      email: user.email,
                    })}
                  >
                    {t("workflows.share.remove")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sharedUsers.length === 0 && !isLoading && (
          <p className="share-workflow-modal__empty">
            {t("workflows.share.noShares")}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default ShareWorkflowModal;
