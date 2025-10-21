import type { WorkflowSummary } from "../types/workflows";

const sanitizeBackendUrl = (value: string): string => value.trim();

const ensureTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value : `${value}/`;

const toUniqueList = (values: string[]): string[] => Array.from(new Set(values));

export const makeApiEndpointCandidates = (
  rawBackendUrl: string,
  path: string,
): string[] => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = [normalizedPath];
  const backendUrl = sanitizeBackendUrl(rawBackendUrl);

  if (!backendUrl) {
    return candidates;
  }

  try {
    const base = ensureTrailingSlash(backendUrl);
    const resolved = new URL(normalizedPath, base).toString();
    candidates.push(resolved);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        "URL backend invalide ignorée pour VITE_BACKEND_URL:",
        backendUrl,
        error,
      );
    }
  }

  return toUniqueList(candidates);
};

const backendUrl = sanitizeBackendUrl(import.meta.env.VITE_BACKEND_URL ?? "");

export class ApiError extends Error {
  status: number | undefined;
  detail: unknown;

  constructor(message: string, options?: { status?: number; detail?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = options?.status;
    this.detail = options?.detail;
  }
}

export const isUnauthorizedError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = await response.clone().json();
    if (payload?.detail) {
      if (typeof payload.detail === "string") {
        return payload.detail;
      }
      return JSON.stringify(payload.detail);
    }
  } catch (err) {
    if (err instanceof Error && err.message) {
      return err.message;
    }
  }
  return `${response.status} ${response.statusText}`;
};

const requestWithFallback = async (
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const endpoints = makeApiEndpointCandidates(backendUrl, path);
  let lastError: Error | ApiError | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, init);
      if (response.ok) {
        return response;
      }

      const message = await extractErrorMessage(response);
      const apiError = new ApiError(message, {
        status: response.status,
        detail: await response.clone().json().catch(() => undefined),
      });

      const isSameOrigin = endpoint.startsWith("/");
      if (isSameOrigin && endpoints.length > 1) {
        lastError = apiError;
        continue;
      }

      throw apiError;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error("Erreur réseau");
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  throw lastError ?? new Error("Impossible de joindre le backend d'administration");
};

const withAuthHeaders = (token: string | null | undefined): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

export type EditableUser = {
  id: number;
  email: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateUserPayload = {
  email: string;
  password: string;
  is_admin: boolean;
};

export type VoiceSettings = {
  instructions: string;
  model: string;
  voice: string;
  prompt_id: string | null;
  prompt_version: string | null;
  prompt_variables: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type VoiceSettingsUpdatePayload = {
  instructions?: string | null;
  model?: string | null;
  voice?: string | null;
  prompt_id?: string | null;
  prompt_version?: string | null;
  prompt_variables?: Record<string, string>;
};

export type ChatKitWorkflowInfo = {
  workflow_id: number;
  workflow_slug: string | null;
  workflow_display_name: string | null;
  definition_id: number;
  definition_version: number;
  auto_start: boolean;
  auto_start_user_message: string | null;
  auto_start_assistant_message: string | null;
  updated_at: string;
};

export const adminApi = {
  async listUsers(token: string | null): Promise<EditableUser[]> {
    const response = await requestWithFallback("/api/admin/users", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async createUser(token: string | null, payload: CreateUserPayload): Promise<EditableUser> {
    const response = await requestWithFallback("/api/admin/users", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async updateUser(token: string | null, id: number, payload: Partial<CreateUserPayload>): Promise<EditableUser> {
    const response = await requestWithFallback(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async deleteUser(token: string | null, id: number): Promise<void> {
    const response = await requestWithFallback(`/api/admin/users/${id}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
    if (!response.ok && response.status !== 204) {
      throw new ApiError("Échec de la suppression", { status: response.status });
    }
  },
};

export const chatkitApi = {
  async getWorkflow(token: string | null): Promise<ChatKitWorkflowInfo> {
    const response = await requestWithFallback("/api/chatkit/workflow", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },
};

export const resetUserPassword = async (
  token: string | null,
  id: number,
  payload: { password: string },
): Promise<EditableUser> => {
  const response = await requestWithFallback(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: withAuthHeaders(token),
    body: JSON.stringify(payload),
  });
  return response.json();
};

export const voiceSettingsApi = {
  async get(token: string | null): Promise<VoiceSettings> {
    const response = await requestWithFallback("/api/admin/voice-settings", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async update(
    token: string | null,
    payload: VoiceSettingsUpdatePayload,
  ): Promise<VoiceSettings> {
    const response = await requestWithFallback("/api/admin/voice-settings", {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },
};


export type WidgetTemplate = {
  slug: string;
  title: string | null;
  description: string | null;
  definition: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WidgetTemplateSummary = {
  slug: string;
  title: string | null;
  description: string | null;
};

export type AvailableModel = {
  id: number;
  name: string;
  display_name: string | null;
  description: string | null;
  supports_reasoning: boolean;
  created_at: string;
  updated_at: string;
};

export type WidgetTemplateCreatePayload = {
  slug: string;
  title?: string | null;
  description?: string | null;
  definition: Record<string, unknown>;
};

export type WidgetTemplateUpdatePayload = {
  title?: string | null;
  description?: string | null;
  definition?: Record<string, unknown>;
};


export type AvailableModelPayload = {
  name: string;
  display_name?: string | null;
  description?: string | null;
  supports_reasoning: boolean;
};

export const modelRegistryApi = {
  async list(token: string | null): Promise<AvailableModel[]> {
    const response = await requestWithFallback("/api/models", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async listAdmin(token: string | null): Promise<AvailableModel[]> {
    const response = await requestWithFallback("/api/admin/models", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async create(token: string | null, payload: AvailableModelPayload): Promise<AvailableModel> {
    const response = await requestWithFallback("/api/admin/models", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async delete(token: string | null, id: number): Promise<void> {
    await requestWithFallback(`/api/admin/models/${id}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
  },
};

export const widgetLibraryApi = {
  async listWidgets(token: string | null): Promise<WidgetTemplate[]> {
    const response = await requestWithFallback("/api/widgets", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async getWidget(token: string | null, slug: string): Promise<WidgetTemplate> {
    const response = await requestWithFallback(`/api/widgets/${encodeURIComponent(slug)}`, {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async listWorkflowWidgets(token: string | null): Promise<WidgetTemplateSummary[]> {
    const response = await requestWithFallback("/api/workflow-widgets", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async createWidget(
    token: string | null,
    payload: WidgetTemplateCreatePayload,
  ): Promise<WidgetTemplate> {
    const response = await requestWithFallback("/api/widgets", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async updateWidget(
    token: string | null,
    slug: string,
    payload: WidgetTemplateUpdatePayload,
  ): Promise<WidgetTemplate> {
    const response = await requestWithFallback(`/api/widgets/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async deleteWidget(token: string | null, slug: string): Promise<void> {
    await requestWithFallback(`/api/widgets/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
  },

  async previewWidget(
    token: string | null,
    definition: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await requestWithFallback("/api/widgets/preview", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ definition }),
    });
    const payload = (await response.json()) as { definition: Record<string, unknown> };
    return payload.definition;
  },
};

export const workflowsApi = {
  async list(token: string | null): Promise<WorkflowSummary[]> {
    const response = await requestWithFallback("/api/workflows", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async setChatkitWorkflow(token: string | null, workflowId: number): Promise<WorkflowSummary> {
    const response = await requestWithFallback("/api/workflows/chatkit", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ workflow_id: workflowId }),
    });
    return response.json();
  },
};

export type VectorStoreSummary = {
  slug: string;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  enable_embeddings: boolean;
  created_at: string;
  updated_at: string;
  documents_count: number;
};

export type VectorStoreCreatePayload = {
  slug: string;
  title?: string | null;
  description?: string | null;
  metadata: Record<string, unknown>;
  enable_embeddings?: boolean;
};

export type VectorStoreDocument = {
  doc_id: string;
  metadata: Record<string, unknown>;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type VectorStoreDocumentDetail = VectorStoreDocument & {
  document: Record<string, unknown>;
};

export type VectorStoreIngestionPayload = {
  doc_id: string;
  document: Record<string, unknown>;
  metadata: Record<string, unknown>;
  store_title?: string | null;
  store_metadata?: Record<string, unknown> | null;
  generate_embeddings?: boolean | null;
};

export type VectorStoreSearchPayload = {
  query: string;
  top_k?: number;
  metadata_filters?: Record<string, unknown> | null;
  dense_weight?: number;
  sparse_weight?: number;
};

export type VectorStoreSearchResult = {
  doc_id: string;
  chunk_index: number;
  text: string;
  metadata: Record<string, unknown>;
  document_metadata: Record<string, unknown>;
  dense_score: number;
  bm25_score: number;
  score: number;
};

export const vectorStoreApi = {
  async listStores(token: string | null): Promise<VectorStoreSummary[]> {
    const response = await requestWithFallback("/api/vector-stores", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async createStore(
    token: string | null,
    payload: VectorStoreCreatePayload,
  ): Promise<VectorStoreSummary> {
    const response = await requestWithFallback("/api/vector-stores", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async deleteStore(token: string | null, slug: string): Promise<void> {
    await requestWithFallback(`/api/vector-stores/${slug}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
  },

  async ingestDocument(
    token: string | null,
    slug: string,
    payload: VectorStoreIngestionPayload,
  ): Promise<VectorStoreDocument> {
    const response = await requestWithFallback(`/api/vector-stores/${slug}/documents`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async listDocuments(token: string | null, slug: string): Promise<VectorStoreDocument[]> {
    const response = await requestWithFallback(`/api/vector-stores/${slug}/documents`, {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async deleteDocument(token: string | null, slug: string, docId: string): Promise<void> {
    await requestWithFallback(
      `/api/vector-stores/${slug}/documents/${encodeURIComponent(docId)}`,
      {
        method: "DELETE",
        headers: withAuthHeaders(token),
      },
    );
  },

  async search(
    token: string | null,
    slug: string,
    payload: VectorStoreSearchPayload,
  ): Promise<VectorStoreSearchResult[]> {
    const response = await requestWithFallback(`/api/vector-stores/${slug}/search_json`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async getDocument(
    token: string | null,
    slug: string,
    docId: string,
  ): Promise<VectorStoreDocumentDetail> {
    const response = await requestWithFallback(
      `/api/vector-stores/${slug}/documents/${encodeURIComponent(docId)}`,
      {
        headers: withAuthHeaders(token),
      },
    );
    return response.json();
  },
};
