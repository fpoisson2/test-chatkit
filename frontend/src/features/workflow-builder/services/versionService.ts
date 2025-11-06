import { makeApiEndpointCandidates } from "../../../utils/backend";
import type { WorkflowVersionResponse, WorkflowVersionSummary } from "../types";

export interface CreateVersionPayload {
  graph: unknown;
  name?: string;
}

export interface UpdateVersionPayload {
  graph: unknown;
  name?: string;
}

/**
 * Service for workflow version management
 */
export class VersionService {
  constructor(
    private backendUrl: string,
    private authHeader: Record<string, string>,
  ) {}

  /**
   * Fetch all versions for a workflow
   */
  async fetchVersions(workflowId: number): Promise<WorkflowVersionSummary[]> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      `/api/workflows/${workflowId}/versions`,
    );
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
          throw new Error(`Failed to load versions (${response.status})`);
        }

        const data: WorkflowVersionSummary[] = await response.json();
        return data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Unknown error");
      }
    }

    throw lastError ?? new Error("Failed to load versions");
  }

  /**
   * Fetch a specific version detail
   */
  async fetchVersionDetail(
    workflowId: number,
    versionId: number,
  ): Promise<WorkflowVersionResponse> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      `/api/workflows/${workflowId}/versions/${versionId}`,
    );
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
          throw new Error(`Failed to load version (${response.status})`);
        }

        const data: WorkflowVersionResponse = await response.json();
        return data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Unknown error");
      }
    }

    throw lastError ?? new Error("Failed to load version");
  }

  /**
   * Create a new version (draft)
   */
  async createVersion(
    workflowId: number,
    payload: CreateVersionPayload,
  ): Promise<WorkflowVersionResponse> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      `/api/workflows/${workflowId}/versions`,
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
          throw new Error(`Failed to create version (${response.status})`);
        }

        const data: WorkflowVersionResponse = await response.json();
        return data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Failed to create version");
      }
    }

    throw lastError ?? new Error("Failed to create version");
  }

  /**
   * Update an existing version
   */
  async updateVersion(
    workflowId: number,
    versionId: number,
    payload: UpdateVersionPayload,
  ): Promise<WorkflowVersionResponse> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      `/api/workflows/${workflowId}/versions/${versionId}`,
    );
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeader,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorDetail =
            typeof errorData === "object" &&
            errorData !== null &&
            "detail" in errorData &&
            typeof errorData.detail === "string"
              ? errorData.detail
              : null;

          throw new Error(
            errorDetail ?? `Failed to update version (${response.status})`,
          );
        }

        const data: WorkflowVersionResponse = await response.json();
        return data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Failed to update version");
      }
    }

    throw lastError ?? new Error("Failed to save changes");
  }

  /**
   * Delete a version
   */
  async deleteVersion(workflowId: number, versionId: number): Promise<void> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      `/api/workflows/${workflowId}/versions/${versionId}`,
    );
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
          return;
        }

        if (response.status === 404) {
          throw new Error("Version not found");
        }

        throw new Error(`Failed to delete version (${response.status})`);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError = error instanceof Error ? error : new Error("Failed to delete version");
      }
    }

    throw lastError ?? new Error("Failed to delete version");
  }
}

/**
 * Create a version service instance
 */
export const createVersionService = (
  backendUrl: string,
  authHeader: Record<string, string>,
): VersionService => {
  return new VersionService(backendUrl, authHeader);
};
