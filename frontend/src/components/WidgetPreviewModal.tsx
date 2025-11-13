import { Modal } from "./Modal";
import { WidgetPreviewPlayground } from "./WidgetPreviewPlayground";

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
    {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
    <WidgetPreviewPlayground definition={definition} />
    <details className="accordion-item mt-6">
      <summary className="accordion-trigger cursor-pointer">Définition JSON normalisée</summary>
      <div className="accordion-content">
        <pre className="code-block" aria-label="Définition JSON du widget">
          {JSON.stringify(definition, null, 2)}
        </pre>
      </div>
    </details>
  </Modal>
);
