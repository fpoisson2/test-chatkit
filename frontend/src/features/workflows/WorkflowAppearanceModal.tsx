import { useCallback, useEffect, useMemo, useState } from "react";

import { Modal } from "../../components/Modal";
import { AppearanceForm } from "../appearance/AppearanceForm";
import { useI18n } from "../../i18n";
import {
  appearanceSettingsApi,
  type AppearanceSettings,
  type AppearanceSettingsUpdatePayload,
  type WorkflowAppearance,
} from "../../utils/backend";

type LocalWorkflowTarget = {
  kind: "local";
  workflowId: number;
  slug: string;
  label: string;
};

type HostedWorkflowTarget = {
  kind: "hosted";
  slug: string;
  label: string;
  remoteWorkflowId: string | null;
};

export type WorkflowAppearanceTarget = LocalWorkflowTarget | HostedWorkflowTarget;

type WorkflowAppearanceModalProps = {
  token: string | null;
  isOpen: boolean;
  target: WorkflowAppearanceTarget | null;
  onClose: () => void;
};

const resolveWorkflowReference = (
  target: WorkflowAppearanceTarget | null,
): number | string | null => {
  if (!target) {
    return null;
  }
  if (target.kind === "local") {
    return target.workflowId;
  }
  return target.slug;
};

const toAppearanceSettings = (
  payload: WorkflowAppearance | null,
): AppearanceSettings | null => {
  if (!payload) {
    return null;
  }
  return payload.effective;
};

export const WorkflowAppearanceModal = ({
  token,
  isOpen,
  target,
  onClose,
}: WorkflowAppearanceModalProps) => {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<WorkflowAppearance | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const workflowReference = useMemo(
    () => resolveWorkflowReference(target),
    [target],
  );

  useEffect(() => {
    if (!isOpen) {
      setSnapshot(null);
      setLoading(false);
      setBusy(false);
      setError(null);
      setSuccess(null);
      return;
    }

    if (!token || workflowReference == null) {
      setSnapshot(null);
      setError(t("workflowAppearance.errors.missingReference"));
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadAppearance = async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);
      try {
        const data = await appearanceSettingsApi.getForWorkflow(
          token,
          workflowReference,
        );
        if (!cancelled) {
          setSnapshot(data);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : t("workflowAppearance.errors.loadFailed");
          setError(message);
          setSnapshot(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAppearance();

    return () => {
      cancelled = true;
    };
  }, [isOpen, token, workflowReference, t]);

  const handleSubmit = useCallback(
    async (payload: AppearanceSettingsUpdatePayload) => {
      if (!token || workflowReference == null) {
        return;
      }
      setBusy(true);
      setError(null);
      setSuccess(null);
      try {
        const updated = await appearanceSettingsApi.updateForWorkflow(
          token,
          workflowReference,
          payload,
        );
        setSnapshot(updated);
        setSuccess(t("workflowAppearance.feedback.saved"));
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("workflowAppearance.errors.saveFailed");
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [token, workflowReference, t],
  );

  const handleReset = useCallback(async () => {
    if (!token || workflowReference == null) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await appearanceSettingsApi.updateForWorkflow(
        token,
        workflowReference,
        { inherit_from_global: true },
      );
      setSnapshot(updated);
      setSuccess(t("workflowAppearance.feedback.reset"));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("workflowAppearance.errors.resetFailed");
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [token, workflowReference, t]);

  const inherited = snapshot?.inherited_from_global ?? true;

  const formFooter = useCallback(
    ({ isBusy: formBusy }: { isBusy: boolean }) => (
      <>
        <button type="submit" className="btn btn-primary" disabled={formBusy}>
          {t("workflowAppearance.actions.save")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={formBusy}
        >
          {t("workflowAppearance.actions.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleReset}
          disabled={formBusy || inherited}
        >
          {t("workflowAppearance.actions.reset")}
        </button>
      </>
    ),
    [handleReset, inherited, onClose, t],
  );

  if (!isOpen || !target) {
    return null;
  }

  const title = target
    ? t("workflowAppearance.modal.title", { label: target.label })
    : t("workflowAppearance.modal.defaultTitle");

  const helpMessage = inherited
    ? t("workflowAppearance.modal.inherited", {
        label: target.label,
      })
    : t("workflowAppearance.modal.customized", {
        label: target.label,
      });

  return (
    <Modal title={title} onClose={onClose} size="lg">
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}
      <p className="form-hint" aria-live="polite">
        {helpMessage}
      </p>
      <AppearanceForm
        initialSettings={toAppearanceSettings(snapshot)}
        isLoading={isLoading}
        isBusy={isBusy}
        autoFocus
        onSubmit={handleSubmit}
        footer={formFooter}
      />
    </Modal>
  );
};

export default WorkflowAppearanceModal;
