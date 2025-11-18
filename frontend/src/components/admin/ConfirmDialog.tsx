import { Modal } from "../Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "default" | "danger";
}

export const ConfirmDialog = ({
  title,
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmDialogProps) => {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === "danger" ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div style={{ padding: "8px 0" }}>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{message}</p>
      </div>
    </Modal>
  );
};
