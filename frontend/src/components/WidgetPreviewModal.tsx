import { Modal } from "./Modal";
import { WidgetPreview } from "./WidgetPreview";

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
    <WidgetPreview definition={definition} />
    <details className="accordion">
      <summary>Définition JSON normalisée</summary>
      <pre className="code-block" aria-label="Définition JSON du widget">
        {JSON.stringify(definition, null, 2)}
      </pre>
    </details>
  </Modal>
);
