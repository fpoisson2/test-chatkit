import { FormEvent, useId } from "react";

import { Modal } from "../../../components/Modal";
import { useI18n } from "../../../i18n";

export type CreateWorkflowKind = "local" | "hosted";

type CreateWorkflowModalProps = {
  isOpen: boolean;
  kind: CreateWorkflowKind;
  name: string;
  remoteId: string;
  error: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onKindChange: (kind: CreateWorkflowKind) => void;
  onNameChange: (value: string) => void;
  onRemoteIdChange: (value: string) => void;
};

export const CreateWorkflowModal = ({
  isOpen,
  kind,
  name,
  remoteId,
  error,
  isSubmitting,
  onClose,
  onSubmit,
  onKindChange,
  onNameChange,
  onRemoteIdChange,
}: CreateWorkflowModalProps) => {
  const { t } = useI18n();
  const formId = useId();
  const nameId = useId();
  const remoteIdId = useId();
  const localInputId = useId();
  const hostedInputId = useId();
  const radioName = `${formId}-kind`;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const footer = (
    <div className="create-workflow-modal__footer">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onClose}
        disabled={isSubmitting}
      >
        {t("workflowBuilder.createWorkflow.modal.cancel")}
      </button>
      <button
        type="submit"
        form={formId}
        className="btn btn-primary"
        disabled={isSubmitting}
      >
        {t("workflowBuilder.createWorkflow.modal.submit")}
      </button>
    </div>
  );

  return (
    <Modal
      title={t("workflowBuilder.createWorkflow.modal.title")}
      onClose={onClose}
      footer={footer}
      size="sm"
      open={isOpen}
    >
      <form id={formId} onSubmit={handleSubmit} className="create-workflow-modal__form">
        <fieldset className="create-workflow-modal__fieldset">
          <legend className="create-workflow-modal__legend">
            {t("workflowBuilder.createWorkflow.modal.typeLabel")}
          </legend>
          <label className="create-workflow-modal__radio" htmlFor={localInputId}>
            <input
              id={localInputId}
              type="radio"
              name={radioName}
              value="local"
              checked={kind === "local"}
              onChange={() => onKindChange("local")}
              disabled={isSubmitting}
            />
            <span>{t("workflowBuilder.createWorkflow.modal.typeLocal")}</span>
          </label>
          <label className="create-workflow-modal__radio" htmlFor={hostedInputId}>
            <input
              id={hostedInputId}
              type="radio"
              name={radioName}
              value="hosted"
              checked={kind === "hosted"}
              onChange={() => onKindChange("hosted")}
              disabled={isSubmitting}
            />
            <span>{t("workflowBuilder.createWorkflow.modal.typeHosted")}</span>
          </label>
        </fieldset>
        <div className="create-workflow-modal__field">
          <label htmlFor={nameId}>{t("workflowBuilder.createWorkflow.modal.nameLabel")}</label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            autoFocus
            disabled={isSubmitting}
          />
        </div>
        {kind === "hosted" ? (
          <div className="create-workflow-modal__field">
            <label htmlFor={remoteIdId}>
              {t("workflowBuilder.createWorkflow.modal.remoteIdLabel")}
            </label>
            <input
              id={remoteIdId}
              type="text"
              value={remoteId}
              onChange={(event) => onRemoteIdChange(event.target.value)}
              disabled={isSubmitting}
            />
          </div>
        ) : null}
        {error ? (
          <p className="create-workflow-modal__error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
};

export default CreateWorkflowModal;
