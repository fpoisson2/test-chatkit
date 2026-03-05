import { FormEvent, useId } from "react";

import { Modal } from "../../../components/Modal";
import { useI18n } from "../../../i18n";

type CreateWorkflowModalProps = {
  isOpen: boolean;
  name: string;
  error: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
};

export const CreateWorkflowModal = ({
  isOpen,
  name,
  error,
  isSubmitting,
  onClose,
  onSubmit,
  onNameChange,
}: CreateWorkflowModalProps) => {
  const { t } = useI18n();
  const formId = useId();
  const nameId = useId();

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
