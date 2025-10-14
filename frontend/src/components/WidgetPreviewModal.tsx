import { Modal } from "./Modal";

type WidgetPreviewModalProps = {
  title: string;
  subtitle?: string | null;
  definition: Record<string, unknown>;
  onClose: () => void;
};

export const WidgetPreviewModal = ({
  title,
  subtitle,
  definition,
  onClose,
}: WidgetPreviewModalProps) => (
  <Modal title={title} onClose={onClose} size="lg">
    {subtitle ? <p className="admin-card__subtitle">{subtitle}</p> : null}
    <pre className="code-block" aria-label="Définition JSON du widget">
      {JSON.stringify(definition, null, 2)}
    </pre>
  </Modal>
);
