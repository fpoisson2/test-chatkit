import { useCallback } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { SidebarIcon } from "./SidebarIcon";
import { useI18n } from "../i18n";
import { preloadRoute } from "../utils/routePreloaders";
import type { SettingsSectionId } from "../features/settings/sections";

type ProfileMenuProps = {
  tabIndex: number;
  onNavigate?: () => void;
};

export const ProfileMenu = ({ tabIndex, onNavigate }: ProfileMenuProps) => {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleOpenSettings = useCallback(
    (sectionId?: SettingsSectionId) => {
      if (!user) {
        navigate("/login");
        return;
      }

      const search = sectionId ? `?section=${encodeURIComponent(sectionId)}` : "";
      navigate(`/settings${search}`);
      onNavigate?.();
    },
    [navigate, user, onNavigate],
  );

  const handleGoToAdmin = useCallback(() => {
    navigate("/admin");
    onNavigate?.();
  }, [navigate, onNavigate]);

  const handleLogout = useCallback(() => {
    logout();
    onNavigate?.();
  }, [logout, onNavigate]);

  if (!user) {
    return null;
  }

  const profileInitial = user.email ? user.email.charAt(0).toUpperCase() : "?";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="chatkit-sidebar__profile-trigger"
          tabIndex={tabIndex}
        >
          <span className="chatkit-sidebar__profile-avatar" aria-hidden="true">
            {profileInitial}
          </span>
          <span className="chatkit-sidebar__profile-details">
            <span className="chatkit-sidebar__profile-name">{user.email}</span>
            <span className="chatkit-sidebar__profile-role">
              {user.is_admin
                ? t("app.sidebar.profile.role.admin")
                : t("app.sidebar.profile.role.user")}
            </span>
          </span>
          <span className="chatkit-sidebar__profile-caret" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="chatkit-sidebar__profile-menu"
          sideOffset={5}
          align="end"
        >
          <DropdownMenu.Item
            className="chatkit-sidebar__profile-action"
            onSelect={handleOpenSettings}
            onMouseEnter={() => preloadRoute("settings")}
            onFocus={() => preloadRoute("settings")}
          >
            <SidebarIcon name="settings" className="chatkit-sidebar__icon" />
            <span>{t("app.sidebar.profile.settings")}</span>
          </DropdownMenu.Item>

          {user.is_admin && (
            <DropdownMenu.Item
              className="chatkit-sidebar__profile-action"
              onSelect={handleGoToAdmin}
              onMouseEnter={() => preloadRoute("admin")}
              onFocus={() => preloadRoute("admin")}
            >
              <SidebarIcon name="admin" className="chatkit-sidebar__icon" />
              <span>{t("app.sidebar.profile.admin")}</span>
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Item
            className="chatkit-sidebar__profile-action chatkit-sidebar__profile-action--logout"
            onSelect={handleLogout}
          >
            <SidebarIcon name="logout" className="chatkit-sidebar__icon" />
            <span>{t("app.sidebar.profile.logout")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
