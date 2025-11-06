import { makeApiEndpointCandidates } from "../../../utils/backend";
import type { WorkflowVersionResponse } from "../types";
import { slugifyWorkflowName } from "../utils";

export interface ExportWorkflowResult {
  graph: unknown;
  fileName: string;
}

export interface ImportWorkflowPayload {
  workflow_id?: number;
  slug?: string;
  display_name?: string;
  description?: string | null;
  mark_as_active?: boolean;
  version_name?: string;
  graph: unknown;
}

/**
 * Service for workflow import/export operations
 */
export class ImportExportService {
  constructor(
    private backendUrl: string,
    private authHeader: Record<string, string>,
  ) {}

  /**
   * Export a workflow version as JSON
   */
  async exportWorkflow(
    workflowId: number,
    versionId: number,
  ): Promise<unknown> {
    const endpoint = `/api/workflows/${workflowId}/versions/${versionId}/export`;
    const candidates = makeApiEndpointCandidates(this.backendUrl, endpoint);
    let lastError: Error | null = null;

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            ...this.authHeader,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to export workflow (${response.status})`);
        }

        const graph = await response.json();
        return graph;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Failed to export workflow");
      }
    }

    throw lastError ?? new Error("Failed to export workflow");
  }

  /**
   * Download workflow as JSON file
   */
  downloadWorkflowAsFile(
    graph: unknown,
    workflowLabel: string,
    versionLabel: string,
  ): void {
    if (typeof document === "undefined") {
      throw new Error("Document not available");
    }

    const serialized = JSON.stringify(graph, null, 2);
    const workflowSlug = slugifyWorkflowName(workflowLabel);
    const versionSlug = slugifyWorkflowName(versionLabel);
    const fileName = `${workflowSlug}-${versionSlug}.json`;

    const blob = new Blob([serialized], {
      type: "application/json;charset=utf-8",
    });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  }

  /**
   * Import a workflow from JSON payload
   */
  async importWorkflow(
    payload: ImportWorkflowPayload,
  ): Promise<WorkflowVersionResponse> {
    const candidates = makeApiEndpointCandidates(
      this.backendUrl,
      "/api/workflows/import",
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
          let detail = `Failed to import workflow (${response.status})`;
          try {
            const data = await response.json();
            if (data && typeof data.detail === "string" && data.detail.trim()) {
              detail = data.detail.trim();
            }
          } catch (parseError) {
            // Ignore parse errors
          }
          throw new Error(detail);
        }

        const imported: WorkflowVersionResponse = await response.json();
        return imported;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          continue;
        }
        lastError =
          error instanceof Error ? error : new Error("Failed to import workflow");
      }
    }

    throw lastError ?? new Error("Failed to import workflow");
  }

  /**
   * Read file as text
   */
  async readFileAsText(file: File): Promise<string> {
    return await file.text();
  }
}

/**
 * Create an import/export service instance
 */
export const createImportExportService = (
  backendUrl: string,
  authHeader: Record<string, string>,
): ImportExportService => {
  return new ImportExportService(backendUrl, authHeader);
};
