export type WorkflowSharePermission = "read" | "write";

export type WorkflowSharedUser = {
  id: number;
  email: string;
  permission: WorkflowSharePermission;
};

export type WorkflowSummary = {
  id: number;
  slug: string;
  display_name: string;
  description: string | null;
  active_version_id: number | null;
  active_version_number: number | null;
  is_chatkit_default: boolean;
  owner_id: number | null;
  owner_email: string | null;
  shared_with: WorkflowSharedUser[];
  lti_enabled: boolean;
  lti_registration_ids: number[];
  lti_show_sidebar: boolean;
  lti_show_header: boolean;
  lti_enable_history: boolean;
  versions_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowVersionSummary = {
  id: number;
  workflow_id: number;
  name: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
