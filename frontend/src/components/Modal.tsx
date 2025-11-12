import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  open?: boolean;
};

export const Modal = ({
  title,
  onClose,
  children,
  footer,
  size = "md",
  open = true,
}: ModalProps) => (
  <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal__overlay" />
      <Dialog.Content className={`modal__container modal__container--${size}`}>
        <header className="modal__header">
          <Dialog.Title className="modal__title">{title}</Dialog.Title>
          <Dialog.Close asChild>
            <button className="modal__close" type="button" aria-label="Fermer">
              ×
            </button>
          </Dialog.Close>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
