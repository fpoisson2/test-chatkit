import { makeApiEndpointCandidates } from "../../../utils/backend";
import type { WorkflowVersionResponse, WorkflowSummary } from "../types";

export interface CreateWorkflowPayload {
  slug: string;
  display_name: string;
  description: string | null;
  graph: unknown | null;
}

export interface DeleteWorkflowResult {
  success: boolean;
  workflowId: number;
}

export interface DeployWorkflowPayload {
  version_id: number;
}

/**
 * Service for workflow CRUD operations
 */
export class WorkflowService {
  constructor(
    private backendUrl: string,
    private authHeader: Record<string, string>,
  ) {}

  /**
   * Fetch all workflows
   */
  async fetchWorkflows(): Promise<WorkflowSummary[]> {
    const candidates = makeApiEndpointCandidates(this.backendUrl, "/api/workflows");
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          headers: {
            "Content-Type": "application/json",
            ...this.authHeader,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to load workflows (${response.status})`);
        }

        const data: WorkflowSummary[] = await response.json();
        return data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Unknown error");
      }
    }

    throw lastError ?? new Error("Failed to load workflows");
  }

  /**
   * Create a new local workflow
   */
  async createWorkflow(payload: CreateWorkflowPayload): Promise<WorkflowVersionResponse> {
    const candidates = makeApiEndpointCandidates(this.backendUrl, "/api/workflows");
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeader,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to create workflow (${response.status})`);
        }

        const data: WorkflowVersionResponse = await response.json();
        return data;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Failed to create workflow");
      }
    }

    throw lastError ?? new Error("Failed to create workflow");
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: number): Promise<DeleteWorkflowResult> {
    const endpoint = `/api/workflows/${workflowId}`;
    const candidates = makeApiEndpointCandidates(this.backendUrl, endpoint);
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeader,
          },
        });

        if (response.status === 204) {
          return { success: true, workflowId };
        }

        if (response.status === 400) {
          let message = "Cannot delete workflow.";
          try {
            const detail = (await response.json()) as { detail?: unknown };
            if (detail && typeof detail.detail === "string") {
              message = detail.detail;
            }
          } catch (parseError) {
            console.error(parseError);
          }
          throw new Error(message);
        }

        if (response.status === 404) {
          throw new Error("Workflow no longer exists.");
        }

        throw new Error(`Cannot delete workflow (${response.status}).`);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error ? error : new Error("Cannot delete workflow.");
      }
    }

    throw lastError ?? new Error("Cannot delete workflow.");
  }

  /**
   * Deploy/Promote a workflow version to production
   */
  async deployWorkflow(
    workflowId: number,
    payload: DeployWorkflowPayload,
  ): Promise<WorkflowVersionResponse> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      `/api/workflows/${workflowId}/production`,
    );
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeader,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to promote version (${response.status})`);
        }

        const promoted: WorkflowVersionResponse = await response.json();
        return promoted;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error ? error : new Error("Failed to promote version");
      }
    }

    throw lastError ?? new Error("Failed to publish workflow");
  }

  /**
   * Rename a workflow
   */
  async renameWorkflow(
    workflowId: number,
    newDisplayName: string,
  ): Promise<WorkflowSummary> {
    const endpoint = `/api/workflows/${workflowId}`;
    const candidates = makeApiEndpointCandidates(this.backendUrl, endpoint);
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeader,
          },
          body: JSON.stringify({ display_name: newDisplayName }),
        });

        if (!response.ok) {
          throw new Error(`Failed to rename workflow (${response.status})`);
        }

        const updated: WorkflowSummary = await response.json();
        return updated;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error ? error : new Error("Failed to rename workflow");
      }
    }

    throw lastError ?? new Error("Failed to rename workflow");
  }
}

/**
 * Create a workflow service instance
 */
export const createWorkflowService = (
  backendUrl: string,
  authHeader: Record<string, string>,
): WorkflowService => {
  return new WorkflowService(backendUrl, authHeader);
};
