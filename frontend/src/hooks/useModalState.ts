import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

type InitialState = boolean | (() => boolean);

type ModalState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

export default function useModalState(initialState: InitialState = false): ModalState {
  const [isOpen, setIsOpen] = useState<boolean>(initialState);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((previous) => !previous);
  }, []);

  return {
    isOpen,
    open,
    close,
    toggle,
    setOpen: setIsOpen,
  };
}
