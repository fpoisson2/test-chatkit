import * as Dialog from "@radix-ui/react-dialog";

import type { AdminSectionKey } from "../config/adminSections";
import { useI18n } from "../i18n";
import { useIsDesktopLayout } from "../hooks/useDesktopLayout";
import { AdminModalDesktop } from "./AdminModalDesktop";
import { AdminModalMobile } from "./AdminModalMobile";

type AdminModalProps = {
  isOpen: boolean;
  onClose: () => void;
  activeTab: AdminSectionKey;
  setActiveTab: (tab: AdminSectionKey) => void;
  saveScrollPosition: (tab: AdminSectionKey, position: number) => void;
  getScrollPosition: (tab: AdminSectionKey) => number;
};

export const AdminModal = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  saveScrollPosition,
  getScrollPosition,
}: AdminModalProps) => {
  const { t } = useI18n();
  const isDesktop = useIsDesktopLayout();

  const title = t("admin.tabs.sectionTitle");

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal__overlay" />
        <Dialog.Content className="modal__container modal__container--xl admin-modal">
          {isDesktop ? (
            <AdminModalDesktop
              title={title}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              saveScrollPosition={saveScrollPosition}
              getScrollPosition={getScrollPosition}
            />
          ) : (
            <>
              <header className="admin-modal__header">
                <Dialog.Title className="admin-modal__title">{title}</Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    className="admin-modal__close"
                    type="button"
                    aria-label={t("common.close")}
                  >
                    ×
                  </button>
                </Dialog.Close>
              </header>
              <AdminModalMobile
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                saveScrollPosition={saveScrollPosition}
                getScrollPosition={getScrollPosition}
              />
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
