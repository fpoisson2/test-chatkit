import type { ReactNode } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
};

export const Modal = ({ title, onClose, children, footer, size = "md" }: ModalProps) => (
  <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div className="modal__overlay" onClick={onClose} />
    <div className={`modal__container modal__container--${size}`}>
      <header className="modal__header">
        <h2 id="modal-title" className="modal__title">
          {title}
        </h2>
        <button className="modal__close" type="button" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </header>
      <div className="modal__body">{children}</div>
      {footer ? <footer className="modal__footer">{footer}</footer> : null}
    </div>
  </div>
);
