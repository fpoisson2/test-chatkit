import type { AuthUser } from "../../auth";
import type { SettingsSection, SettingsSectionId } from "./sections";
import type { UseAdminUsersResult } from "./useAdminUsers";
import { SettingsPreferencesSection } from "./SettingsPreferencesSection";
import { SettingsUsersSection } from "./SettingsUsersSection";
import { useI18n } from "../../i18n";

export type SettingsModalProps = {
  isOpen: boolean;
  sections: SettingsSection[];
  activeSectionId: SettingsSectionId;
  onSelectSection: (sectionId: SettingsSectionId) => void;
  onClose: () => void;
  currentUser: AuthUser | null;
  onGoHome: () => void;
  onLogout: () => void;
  onOpenWorkflows: () => void;
  adminUsers: UseAdminUsersResult;
};

export function SettingsModal({
  isOpen,
  sections,
  activeSectionId,
  onSelectSection,
  onClose,
  currentUser,
  onGoHome,
  onLogout,
  onOpenWorkflows,
  adminUsers,
}: SettingsModalProps) {
  const { t } = useI18n();
  if (!isOpen) {
    return null;
  }

  const activeSection =
    sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__panel" role="document">
        <header className="settings-modal__header">
          <div>
            <h2 id="settings-modal-title" className="settings-modal__title">
              {t("settings.modal.title")}
            </h2>
            <p className="settings-modal__subtitle">
              {t("settings.modal.subtitle")}
            </p>
          </div>
          <button
            type="button"
            className="settings-modal__close"
            onClick={onClose}
            aria-label={t("settings.modal.close")}
          >
            ×
          </button>
        </header>
        <div className="settings-modal__body">
          <nav className="settings-modal__sidebar" aria-label={t("settings.modal.navLabel")}>
            <ul className="settings-modal__nav">
              {sections.map((section) => {
                const isActive = section.id === activeSectionId;
                return (
                  <li key={section.id} className="settings-modal__nav-item">
                    <button
                      type="button"
                      className={`settings-modal__nav-button${
                        isActive ? " settings-modal__nav-button--active" : ""
                      }`}
                      onClick={() => onSelectSection(section.id)}
                      aria-current={isActive ? "page" : undefined}
                      aria-controls={`settings-section-${section.id}`}
                    >
                      {section.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="settings-modal__main">
            {activeSection?.id === "preferences" ? (
              <SettingsPreferencesSection key={activeSection.id} activeSection={activeSection} />
            ) : null}
            {activeSection?.id === "users" ? (
              <SettingsUsersSection
                key={activeSection.id}
                activeSection={activeSection}
                currentUser={currentUser}
                onGoHome={onGoHome}
                onLogout={onLogout}
                onOpenWorkflows={onOpenWorkflows}
                state={adminUsers.state}
                actions={adminUsers.actions}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
