/**
 * Types for conversation branching feature
 */

/**
 * Represents a conversation branch
 */
export interface Branch {
  branch_id: string;
  name: string | null;
  is_default: boolean;
  parent_branch_id: string | null;
  fork_point_item_id: string | null;
  created_at: string;
}

/**
 * Response from the list branches API
 */
export interface BranchListResponse {
  branches: Branch[];
  current_branch_id: string;
}

/**
 * Request to create a new branch
 */
export interface CreateBranchRequest {
  fork_after_item_id: string;
  name?: string;
  edited_content?: string;
}

/**
 * Response from creating a branch
 */
export interface CreateBranchResponse {
  branch_id: string;
  thread_id: string;
  parent_branch_id: string;
  fork_point_item_id: string;
  name: string | null;
  is_default: boolean;
  created_at: string;
}

/**
 * Response from switching branches
 */
export interface SwitchBranchResponse {
  branch_id: string;
  thread_id: string;
}

/**
 * Default branch ID constant
 */
export const MAIN_BRANCH_ID = 'main';
