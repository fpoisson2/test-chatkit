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
