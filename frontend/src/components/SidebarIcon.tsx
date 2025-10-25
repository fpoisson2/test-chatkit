import type { ReactNode } from "react";

export type SidebarIconName =
  | "logo"
  | "home"
  | "admin"
  | "workflow"
  | "settings"
  | "login"
  | "logout"
  | "docs"
  | "close";

const SIDEBAR_ICONS: Record<SidebarIconName, ReactNode> = {
  logo: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.15" />
      <path
        d="M9 9.75c0-1.24 1-2.25 2.25-2.25h2.5A2.25 2.25 0 0 1 16 9.75v1.25a2.25 2.25 0 0 1-2.25 2.25H12l-2.5 2v-2H11.25A2.25 2.25 0 0 1 9 10.75Z"
        fill="currentColor"
      />
    </>
  ),
  home: (
    <>
      <path
        d="M2.25 12 12 2.25 21.75 12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 9.75v10.5A1.5 1.5 0 0 0 6 21.75h3.75V15h4.5v6.75H18a1.5 1.5 0 0 0 1.5-1.5V9.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  admin: (
    <>
      <path
        d="M12 21a9 9 0 0 0 9-9V7.286a1 1 0 0 0-.469-.853l-8.25-5.156a1 1 0 0 0-1.062 0L3.969 6.433A1 1 0 0 0 3.5 7.286V12a9 9 0 0 0 9 9Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m9 12.75 2.25 2.25L15 9.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  workflow: (
    <>
      <circle cx="6.5" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="5.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8.3 8.2 11 12m3.2 1.6L16 7.4M12 16V14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  settings: (
    <>
      <path
        d="M21 12a2.25 2.25 0 0 0-1.125-1.95l-1.755-1.012a7.01 7.01 0 0 0-.366-.884l.34-1.962A2.25 2.25 0 0 0 15.877 3.5h-3.754a2.25 2.25 0 0 0-2.217 1.692l-.34 1.962c-.13.287-.25.582-.366.884L7.463 10.05A2.25 2.25 0 0 0 6.338 12c0 .76.395 1.464 1.125 1.95l1.755 1.012c.117.302.237.597.366.884l-.34 1.962a2.25 2.25 0 0 0 2.217 2.692h3.754a2.25 2.25 0 0 0 2.217-1.692l.34-1.962c.13-.287.25-.582.366-.884l1.755-1.012A2.25 2.25 0 0 0 21 12Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  login: (
    <>
      <path
        d="M15 8.25 19.5 12 15 15.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M19.5 12H6.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8.25 4.5h-1.5A2.25 2.25 0 0 0 4.5 6.75v10.5A2.25 2.25 0 0 0 6.75 19.5h1.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  logout: (
    <>
      <path
        d="M9 8.25 4.5 12 9 15.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 12h12.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M15.75 19.5h1.5A2.25 2.25 0 0 0 19.5 17.25V6.75A2.25 2.25 0 0 0 17.25 4.5h-1.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  docs: (
    <>
      <path
        d="M6.75 4.5h4.5v15h-4.5A2.25 2.25 0 0 0 4.5 21.75V6.75A2.25 2.25 0 0 1 6.75 4.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M17.25 4.5h-4.5v15h4.5a2.25 2.25 0 0 1 2.25 2.25V6.75A2.25 2.25 0 0 0 17.25 4.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M10.5 8.25h3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M10.5 12h3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  close: (
    <>
      <path
        d="M7.5 7.5 16.5 16.5m0-9L7.5 16.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
};

export const SidebarIcon = ({
  name,
  className,
}: {
  name: SidebarIconName;
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={24}
    height={24}
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    {SIDEBAR_ICONS[name]}
  </svg>
);
