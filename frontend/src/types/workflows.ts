export type WorkflowPermission = "admin" | "write" | "read";

export type WorkflowSummary = {
  id: number;
  slug: string;
  display_name: string;
  description: string | null;
  active_version_id: number | null;
  active_version_number: number | null;
  is_chatkit_default: boolean;
  lti_enabled: boolean;
  lti_registration_ids: number[];
  lti_show_sidebar: boolean;
  lti_show_header: boolean;
  lti_enable_history: boolean;
  // Multi-user conversation settings
  multi_user_enabled: boolean;
  multi_user_auto_call_ai: boolean;
  multi_user_allow_instructor_annotations: boolean;
  versions_count: number;
  created_at: string;
  updated_at: string;
  // User's permission level for this workflow
  user_permission: WorkflowPermission | null;
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
