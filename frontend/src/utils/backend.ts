import type { WorkflowSummary } from "../types/workflows";

type NullableString = string | null | undefined;

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

export type ChatkitSessionResponse = {
  client_secret: string;
  expires_at?: unknown;
  expiresAt?: unknown;
};

export const fetchChatkitSession = async ({
  user,
  token,
  hostedWorkflowSlug,
  signal,
}: {
  user: string;
  token: string | null | undefined;
  hostedWorkflowSlug?: string | null;
  signal?: AbortSignal;
}): Promise<ChatkitSessionResponse> => {
  const response = await requestWithFallback("/api/chatkit/session", {
    method: "POST",
    headers: withAuthHeaders(token ?? null),
    body: JSON.stringify({
      user,
      hosted_workflow_slug: hostedWorkflowSlug ?? undefined,
    }),
    signal,
  });

  return response.json();
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

export type McpTestConnectionPayload = {
  type: "mcp";
  transport: "http_sse";
  url: string;
  authorization?: string;
};

export type McpTestConnectionResponse = {
  status: string;
  detail?: string;
  status_code?: number;
  tool_names?: string[];
  server_id?: number;
  allow?: { tools?: string[] };
  tools_cache_updated_at?: string;
};

export type McpServerSummary = {
  id: number;
  label: string;
  server_url: string;
  transport: string | null;
  is_active: boolean;
  oauth_client_id: string | null;
  oauth_scope: string | null;
  oauth_authorization_endpoint: string | null;
  oauth_token_endpoint: string | null;
  oauth_redirect_uri: string | null;
  oauth_metadata: Record<string, unknown> | null;
  authorization_hint: string | null;
  access_token_hint: string | null;
  refresh_token_hint: string | null;
  oauth_client_secret_hint: string | null;
  tools_cache: Record<string, unknown> | null;
  tools_cache_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type McpServerPayload = {
  label?: NullableString;
  server_url?: NullableString;
  transport?: NullableString;
  is_active?: boolean;
  authorization?: NullableString;
  access_token?: NullableString;
  refresh_token?: NullableString;
  oauth_client_id?: NullableString;
  oauth_client_secret?: NullableString;
  oauth_scope?: NullableString;
  oauth_authorization_endpoint?: NullableString;
  oauth_token_endpoint?: NullableString;
  oauth_redirect_uri?: NullableString;
  oauth_metadata?: Record<string, unknown> | null;
  refresh_tools?: boolean;
};

export type LtiRegistration = {
  id: number;
  issuer: string;
  client_id: string;
  key_set_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  deep_link_return_url: string | null;
  audience: string | null;
  created_at: string;
  updated_at: string;
};

export type LtiRegistrationCreatePayload = {
  issuer: string;
  client_id: string;
  key_set_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  deep_link_return_url?: NullableString;
  audience?: NullableString;
};

export type LtiRegistrationUpdatePayload = {
  issuer?: NullableString;
  client_id?: NullableString;
  key_set_url?: NullableString;
  authorization_endpoint?: NullableString;
  token_endpoint?: NullableString;
  deep_link_return_url?: NullableString;
  audience?: NullableString;
};

export type LtiToolSettings = {
  client_id: string | null;
  key_set_url: string | null;
  audience: string | null;
  key_id: string | null;
  has_private_key: boolean;
  private_key_hint: string | null;
  private_key_path: string | null;
  public_key_path: string | null;
  public_key_pem: string | null;
  public_key_last_updated_at: string | null;
  is_client_id_overridden: boolean;
  is_key_set_url_overridden: boolean;
  is_audience_overridden: boolean;
  is_key_id_overridden: boolean;
  is_private_key_overridden: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type McpServerProbeRequest = {
  serverId?: number | null;
  url: string;
  authorization?: NullableString;
};

export type VoiceSettings = {
  instructions: string;
  model: string;
  provider_id: string | null;
  provider_slug: string | null;
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
  provider_id?: string | null;
  provider_slug?: string | null;
  voice?: string | null;
  prompt_id?: string | null;
  prompt_version?: string | null;
  prompt_variables?: Record<string, string>;
};

export type ModelProviderProfile = {
  id: string;
  provider: string;
  api_base: string | null;
  api_key_hint: string | null;
  has_api_key: boolean;
  is_default: boolean;
};

export type ModelProviderUpdatePayload = {
  id?: string | null;
  provider: string;
  api_base: string | null;
  api_key?: string | null;
  delete_api_key?: boolean;
  is_default: boolean;
};

export type AppSettings = {
  thread_title_prompt: string;
  default_thread_title_prompt: string;
  is_custom_thread_title_prompt: boolean;
  thread_title_model: string;
  default_thread_title_model: string;
  is_custom_thread_title_model: boolean;
  model_provider: string;
  model_api_base: string;
  is_model_provider_overridden: boolean;
  is_model_api_base_overridden: boolean;
  is_model_api_key_managed: boolean;
  model_api_key_hint: string | null;
  model_providers: ModelProviderProfile[];
  sip_trunk_uri: string | null;
  sip_trunk_username: string | null;
  sip_trunk_password: string | null;
  sip_contact_host: string | null;
  sip_contact_port: number | null;
  sip_contact_transport: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AppSettingsUpdatePayload = {
  thread_title_prompt?: string | null;
  thread_title_model?: string | null;
  model_provider?: string | null;
  model_api_base?: string | null;
  model_api_key?: string | null;
  model_providers?: ModelProviderUpdatePayload[] | null;
  sip_trunk_uri?: string | null;
  sip_trunk_username?: string | null;
  sip_trunk_password?: string | null;
  sip_contact_host?: string | null;
  sip_contact_port?: number | null;
  sip_contact_transport?: string | null;
};

export type AppearanceSettings = {
  color_scheme: "system" | "light" | "dark";
  accent_color: string;
  use_custom_surface_colors: boolean;
  surface_hue: number;
  surface_tint: number;
  surface_shade: number;
  heading_font: string;
  body_font: string;
  start_screen_greeting: string;
  start_screen_prompt: string;
  start_screen_placeholder: string;
  start_screen_disclaimer: string;
  created_at: string | null;
  updated_at: string | null;
};

export type AppearanceSettingsUpdatePayload = {
  color_scheme?: "system" | "light" | "dark" | null;
  accent_color?: string | null;
  use_custom_surface_colors?: boolean | null;
  surface_hue?: number | null;
  surface_tint?: number | null;
  surface_shade?: number | null;
  heading_font?: string | null;
  body_font?: string | null;
  start_screen_greeting?: string | null;
  start_screen_prompt?: string | null;
  start_screen_placeholder?: string | null;
  start_screen_disclaimer?: string | null;
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

type HostedWorkflowApiEntry = {
  id?: string | number | null;
  slug: string;
  label: string;
  description?: string | null;
  available: boolean;
  managed?: boolean;
  workflow_id?: string | number | null;
  workflowId?: string | number | null;
  remote_workflow_id?: string | number | null;
  remoteWorkflowId?: string | number | null;
};

export type HostedWorkflowMetadata = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  available: boolean;
  managed: boolean;
  remoteWorkflowId: string | null;
};

const coerceHostedWorkflowId = (entry: HostedWorkflowApiEntry): string => {
  const candidate =
    entry.id ??
    entry.workflow_id ??
    entry.workflowId ??
    entry.remote_workflow_id ??
    entry.remoteWorkflowId;

  if (candidate == null) {
    return entry.slug;
  }

  if (typeof candidate === "string") {
    const normalized = candidate.trim();
    return normalized || entry.slug;
  }

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }

  return String(candidate) || entry.slug;
};

export const normalizeHostedWorkflowMetadata = (
  entry: HostedWorkflowApiEntry,
): HostedWorkflowMetadata => {
  const rawDescription =
    typeof entry.description === "string" ? entry.description.trim() : entry.description;

  return {
    id: coerceHostedWorkflowId(entry),
    slug: entry.slug,
    label: entry.label,
    description: rawDescription ? String(rawDescription) : null,
    available: Boolean(entry.available),
    managed: Boolean(entry.managed),
    remoteWorkflowId: (() => {
      const candidate =
        entry.remote_workflow_id ?? entry.remoteWorkflowId ?? entry.workflow_id ?? entry.workflowId;
      if (candidate == null) {
        return null;
      }
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        return trimmed || null;
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return String(candidate);
      }
      return String(candidate) || null;
    })(),
  };
};

export type WorkflowAppearanceOverride = {
  color_scheme: "system" | "light" | "dark" | null;
  accent_color: string | null;
  use_custom_surface_colors: boolean | null;
  surface_hue: number | null;
  surface_tint: number | null;
  surface_shade: number | null;
  heading_font: string | null;
  body_font: string | null;
  start_screen_greeting: string | null;
  start_screen_prompt: string | null;
  start_screen_placeholder: string | null;
  start_screen_disclaimer: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type WorkflowAppearance = {
  target_kind: "local" | "hosted";
  workflow_id: number | null;
  workflow_slug: string;
  label: string;
  remote_workflow_id: string | null;
  override: WorkflowAppearanceOverride | null;
  effective: AppearanceSettings;
  inherited_from_global: boolean;
};

export type WorkflowAppearanceUpdatePayload = AppearanceSettingsUpdatePayload & {
  inherit_from_global?: boolean | null;
};

export type McpOAuthStartResponse = {
  authorization_url: string;
  state: string;
  expires_in: number;
  redirect_uri: string;
  server_id?: number;
};

export type McpOAuthSessionStatusPending = {
  state: string;
  status: "pending";
  expires_in: number;
};

export type McpOAuthSessionStatusSuccess = McpOAuthSessionStatusPending & {
  status: "ok";
  token: Record<string, unknown>;
};

export type McpOAuthSessionStatusError = McpOAuthSessionStatusPending & {
  status: "error";
  error?: string;
};

export type McpOAuthSessionStatus =
  | McpOAuthSessionStatusPending
  | McpOAuthSessionStatusSuccess
  | McpOAuthSessionStatusError;

const normalizeOptionalString = (value: NullableString): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const buildMcpServerRequestBody = (
  payload: McpServerPayload,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {};

  const assignString = (key: keyof McpServerPayload) => {
    const value = payload[key];
    const normalized = normalizeOptionalString(value);
    if (normalized === undefined) {
      return;
    }
    body[key] = normalized;
  };

  assignString("label");
  assignString("server_url");
  assignString("transport");
  if (payload.is_active !== undefined && payload.is_active !== null) {
    body.is_active = Boolean(payload.is_active);
  }
  assignString("authorization");
  assignString("access_token");
  assignString("refresh_token");
  assignString("oauth_client_id");
  assignString("oauth_client_secret");
  assignString("oauth_scope");
  assignString("oauth_authorization_endpoint");
  assignString("oauth_token_endpoint");
  assignString("oauth_redirect_uri");

  if (payload.oauth_metadata !== undefined) {
    body.oauth_metadata = payload.oauth_metadata;
  }

  if (payload.refresh_tools !== undefined && payload.refresh_tools !== null) {
    body.refresh_tools = Boolean(payload.refresh_tools);
  }

  return body;
};

const buildLtiRegistrationCreateBody = (
  payload: LtiRegistrationCreatePayload,
): Record<string, unknown> => ({
  issuer: payload.issuer.trim(),
  client_id: payload.client_id.trim(),
  key_set_url: payload.key_set_url.trim(),
  authorization_endpoint: payload.authorization_endpoint.trim(),
  token_endpoint: payload.token_endpoint.trim(),
  deep_link_return_url:
    normalizeOptionalString(payload.deep_link_return_url) ?? undefined,
  audience: normalizeOptionalString(payload.audience) ?? undefined,
});

const buildLtiRegistrationUpdateBody = (
  payload: LtiRegistrationUpdatePayload,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  if (payload.issuer !== undefined) {
    body.issuer = payload.issuer?.trim() || null;
  }
  if (payload.client_id !== undefined) {
    body.client_id = payload.client_id?.trim() || null;
  }

  const assignRequired = (
    key: "key_set_url" | "authorization_endpoint" | "token_endpoint",
  ) => {
    if (!(key in payload)) {
      return;
    }
    const value = payload[key];
    if (value === undefined || value === null) {
      return;
    }
    const trimmed = value.trim();
    body[key] = trimmed;
  };

  assignRequired("key_set_url");
  assignRequired("authorization_endpoint");
  assignRequired("token_endpoint");

  const optional = (
    key: "deep_link_return_url" | "audience",
  ) => {
    if (!(key in payload)) {
      return;
    }
    const normalized = normalizeOptionalString(payload[key]);
    body[key] = normalized === undefined ? null : normalized;
  };

  optional("deep_link_return_url");
  optional("audience");

  return body;
};

const mergeMcpServerPayload = (
  base: McpServerPayload | undefined,
  updates: McpServerPayload,
): McpServerPayload => ({
  ...(base ?? {}),
  ...updates,
});

export type McpOAuthPersistencePlan = {
  serverId?: number | null;
  payload: McpServerPayload;
  refreshToolsOnSuccess?: boolean;
  storeTokenMetadata?: boolean;
};

export const startMcpOAuthNegotiation = async ({
  token,
  url,
  clientId,
  scope,
  signal,
  persistence,
}: {
  token: string | null | undefined;
  url: string;
  clientId?: string | null;
  scope?: string | null;
  signal?: AbortSignal;
  persistence?: McpOAuthPersistencePlan | null;
}): Promise<McpOAuthStartResponse> => {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error("Missing OAuth provider URL");
  }

  const payload: Record<string, string | number> = { url: trimmedUrl };

  const normalizedClientId = clientId?.trim();
  if (normalizedClientId) {
    payload.client_id = normalizedClientId;
  }

  const normalizedScope = scope?.trim();
  if (normalizedScope) {
    payload.scope = normalizedScope;
  }

  let persistedServerId: number | null = null;

  if (persistence) {
    const base: McpServerPayload = mergeMcpServerPayload(persistence.payload, {
      server_url: persistence.payload.server_url ?? trimmedUrl,
      oauth_client_id: persistence.payload.oauth_client_id ?? normalizedClientId ?? null,
      oauth_scope: persistence.payload.oauth_scope ?? normalizedScope ?? null,
      refresh_tools: false,
    });

    if (persistence.serverId != null) {
      const result = await updateMcpServer(token ?? null, persistence.serverId, base);
      persistedServerId = result.id;
    } else {
      const result = await createMcpServer(token ?? null, base);
      persistedServerId = result.id;
    }
  }

  if (persistedServerId != null) {
    payload.server_id = persistedServerId;
  }

  const response = await requestWithFallback("/api/tools/mcp/oauth/start", {
    method: "POST",
    headers: withAuthHeaders(token ?? null),
    body: JSON.stringify(payload),
    signal,
  });

  const result: McpOAuthStartResponse = await response.json();

  if (persistedServerId != null) {
    return { ...result, server_id: persistedServerId };
  }
  return result;
};

export const pollMcpOAuthSession = async ({
  token,
  state,
  signal,
  persistence,
}: {
  token: string | null | undefined;
  state: string;
  signal?: AbortSignal;
  persistence?: McpOAuthPersistencePlan | null;
}): Promise<McpOAuthSessionStatus> => {
  if (!state.trim()) {
    throw new Error("Missing OAuth session state");
  }

  const response = await requestWithFallback(
    `/api/tools/mcp/oauth/session/${encodeURIComponent(state)}`,
    {
      headers: withAuthHeaders(token ?? null),
      signal,
    },
  );

  const result: McpOAuthSessionStatus = await response.json();

  if (
    persistence &&
    persistence.serverId != null &&
    result.status === "ok" &&
    result.token &&
    typeof result.token === "object"
  ) {
    const tokenPayload = result.token as Record<string, unknown>;
    const accessTokenRaw = tokenPayload.access_token;
    const refreshTokenRaw = tokenPayload.refresh_token;
    const tokenTypeRaw = tokenPayload.token_type;

    const accessToken =
      typeof accessTokenRaw === "string" ? accessTokenRaw.trim() : undefined;
    const refreshToken =
      typeof refreshTokenRaw === "string" ? refreshTokenRaw.trim() : undefined;
    const tokenType =
      typeof tokenTypeRaw === "string" ? tokenTypeRaw.trim() : undefined;

    const updatePayload: McpServerPayload = mergeMcpServerPayload(
      persistence.payload,
      {
        refresh_tools:
          persistence.refreshToolsOnSuccess === undefined
            ? true
            : Boolean(persistence.refreshToolsOnSuccess),
      },
    );

    if (accessToken) {
      updatePayload.access_token = accessToken;
      updatePayload.authorization = tokenType
        ? `${tokenType} ${accessToken}`.trim()
        : `Bearer ${accessToken}`;
    }

    if (refreshToken) {
      updatePayload.refresh_token = refreshToken;
    }

    if (persistence.storeTokenMetadata) {
      updatePayload.oauth_metadata = {
        ...(persistence.payload.oauth_metadata ?? {}),
        token: tokenPayload,
      };
    }

    try {
      await updateMcpServer(token ?? null, persistence.serverId, updatePayload);
    } catch (error) {
      console.error("Failed to persist MCP server after OAuth flow", error);
    }
  }

  return result;
};

export const cancelMcpOAuthSession = async ({
  token,
  state,
  signal,
}: {
  token: string | null | undefined;
  state: string;
  signal?: AbortSignal;
}): Promise<void> => {
  if (!state.trim()) {
    return;
  }

  await requestWithFallback(`/api/tools/mcp/oauth/session/${encodeURIComponent(state)}`, {
    method: "DELETE",
    headers: withAuthHeaders(token ?? null),
    signal,
  });
};

let hostedWorkflowCache: HostedWorkflowMetadata[] | null | undefined;
let hostedWorkflowPromise: Promise<HostedWorkflowMetadata[] | null> | null = null;

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

  async getActiveWorkflowSessions(token: string | null): Promise<{
    sessions: Array<{
      thread_id: string;
      user: { id: number; email: string; is_admin: boolean };
      workflow: { id: number; slug: string; display_name: string; definition_id: number | null };
      current_step: { slug: string; display_name: string; timestamp: string | null };
      step_history: Array<{ slug: string; display_name: string; timestamp: string | null }>;
      started_at: string;
      last_activity: string;
      status: "active" | "waiting_user" | "paused";
    }>;
    total_count: number;
  }> {
    const response = await requestWithFallback("/api/admin/workflows/active-sessions", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async terminateWorkflowSession(token: string | null, threadId: string): Promise<{ success: boolean; message: string }> {
    const response = await requestWithFallback(`/api/admin/workflows/sessions/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async resetWorkflowSession(token: string | null, threadId: string): Promise<{ success: boolean; message: string }> {
    const response = await requestWithFallback(`/api/admin/workflows/sessions/${encodeURIComponent(threadId)}/reset`, {
      method: "POST",
      headers: withAuthHeaders(token),
    });
    return response.json();
  },
};

export const ltiAdminApi = {
  async listRegistrations(token: string | null): Promise<LtiRegistration[]> {
    const response = await requestWithFallback("/api/admin/lti/registrations", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async createRegistration(
    token: string | null,
    payload: LtiRegistrationCreatePayload,
  ): Promise<LtiRegistration> {
    const body = buildLtiRegistrationCreateBody(payload);
    const response = await requestWithFallback("/api/admin/lti/registrations", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(body),
    });
    return response.json();
  },

  async updateRegistration(
    token: string | null,
    id: number,
    payload: LtiRegistrationUpdatePayload,
  ): Promise<LtiRegistration> {
    const body = buildLtiRegistrationUpdateBody(payload);
    const response = await requestWithFallback(
      `/api/admin/lti/registrations/${id}`,
      {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify(body),
      },
    );
    return response.json();
  },

  async deleteRegistration(token: string | null, id: number): Promise<void> {
    const response = await requestWithFallback(
      `/api/admin/lti/registrations/${id}`,
      {
        method: "DELETE",
        headers: withAuthHeaders(token),
      },
    );
    if (!response.ok && response.status !== 204) {
      throw new ApiError("Échec de la suppression de l'enregistrement LTI", {
        status: response.status,
      });
    }
  },

  async getToolSettings(token: string | null): Promise<LtiToolSettings> {
    const response = await requestWithFallback("/api/admin/lti/tool-settings", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },
};

export const appSettingsApi = {
  async get(token: string | null): Promise<AppSettings> {
    const response = await requestWithFallback("/api/admin/app-settings", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async update(
    token: string | null,
    payload: AppSettingsUpdatePayload,
  ): Promise<AppSettings> {
    const response = await requestWithFallback("/api/admin/app-settings", {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },
};

export const mcpServersApi = {
  async list(token: string | null): Promise<McpServerSummary[]> {
    const response = await requestWithFallback("/api/admin/mcp-servers", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async create(
    token: string | null,
    payload: McpServerPayload,
  ): Promise<McpServerSummary> {
    const body = buildMcpServerRequestBody(payload);
    const response = await requestWithFallback("/api/admin/mcp-servers", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(body),
    });
    return response.json();
  },

  async update(
    token: string | null,
    serverId: number,
    payload: McpServerPayload,
  ): Promise<McpServerSummary> {
    const body = buildMcpServerRequestBody(payload);
    const response = await requestWithFallback(`/api/admin/mcp-servers/${serverId}`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(body),
    });
    return response.json();
  },

  async delete(token: string | null, serverId: number): Promise<void> {
    const response = await requestWithFallback(`/api/admin/mcp-servers/${serverId}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
    if (!response.ok && response.status !== 204) {
      throw new ApiError("Échec de la suppression du serveur MCP", {
        status: response.status,
      });
    }
  },

  async probe(
    token: string | null,
    payload: McpServerProbeRequest,
  ): Promise<McpTestConnectionResponse> {
    const body: Record<string, unknown> = {
      type: "mcp",
      transport: "http_sse",
      url: payload.url.trim(),
    };

    if (payload.serverId != null) {
      body.server_id = payload.serverId;
    }

    const authorization = normalizeOptionalString(payload.authorization);
    if (authorization) {
      body.authorization = authorization;
    }

    const response = await requestWithFallback("/api/tools/mcp/test-connection", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(body),
    });
    return response.json();
  },
};

type AppearanceSettingsScope = "admin" | "public";

type AppearanceSettingsGetOptions = {
  scope?: AppearanceSettingsScope;
  workflowId?: number | string | null;
};

export const appearanceSettingsApi = {
  async get(
    token: string | null,
    options: AppearanceSettingsGetOptions = {},
  ): Promise<AppearanceSettings> {
    const scope: AppearanceSettingsScope = options.scope
      ? options.scope
      : token
      ? "admin"
      : "public";
    let url =
      scope === "admin"
        ? "/api/admin/appearance-settings"
        : "/api/appearance-settings";
    if (scope !== "admin" && options.workflowId != null) {
      url = `${url}?workflow_id=${encodeURIComponent(String(options.workflowId))}`;
    }
    const init: RequestInit = {};
    if (scope === "admin") {
      init.headers = withAuthHeaders(token);
    }
    const response = await requestWithFallback(url, init);
    return response.json();
  },

  async update(
    token: string | null,
    payload: AppearanceSettingsUpdatePayload,
  ): Promise<AppearanceSettings> {
    const response = await requestWithFallback("/api/admin/appearance-settings", {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async getForWorkflow(
    token: string | null,
    reference: number | string,
  ): Promise<WorkflowAppearance> {
    const response = await requestWithFallback(
      `/api/workflows/${encodeURIComponent(String(reference))}/appearance`,
      {
        headers: withAuthHeaders(token),
      },
    );
    return response.json();
  },

  async updateForWorkflow(
    token: string | null,
    reference: number | string,
    payload: WorkflowAppearanceUpdatePayload,
  ): Promise<WorkflowAppearance> {
    const response = await requestWithFallback(
      `/api/workflows/${encodeURIComponent(String(reference))}/appearance`,
      {
        method: "PATCH",
        headers: withAuthHeaders(token),
        body: JSON.stringify(payload),
      },
    );
    return response.json();
  },
};

const { create: createMcpServer, update: updateMcpServer } = mcpServersApi;

export const probeMcpServer = mcpServersApi.probe;

export const chatkitApi = {
  async getWorkflow(token: string | null): Promise<ChatKitWorkflowInfo> {
    const response = await requestWithFallback("/api/chatkit/workflow", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async getHostedWorkflows(
    token: string | null,
    options: { cache?: boolean } = {},
  ): Promise<HostedWorkflowMetadata[] | null> {
    const useCache = options.cache !== false;

    if (useCache && hostedWorkflowCache !== undefined) {
      return hostedWorkflowCache;
    }

    if (useCache && hostedWorkflowPromise) {
      return hostedWorkflowPromise;
    }

    const fetchPromise = (async () => {
      try {
        const response = await requestWithFallback("/api/chatkit/hosted", {
          headers: withAuthHeaders(token),
        });
        const payload = (await response.json()) as HostedWorkflowApiEntry[];
        const normalized = payload.map((entry) => normalizeHostedWorkflowMetadata(entry));
        if (useCache) {
          hostedWorkflowCache = normalized;
        }
        return normalized;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          if (useCache) {
            hostedWorkflowCache = null;
          }
          return null;
        }

        if (useCache) {
          hostedWorkflowCache = undefined;
        }

        throw error;
      } finally {
        if (useCache) {
          hostedWorkflowPromise = null;
        }
      }
    })();

    if (useCache) {
      hostedWorkflowPromise = fetchPromise;
    }

    return fetchPromise;
  },

  async createHostedWorkflow(
    token: string | null,
    payload: {
      slug: string;
      workflow_id: string;
      label: string;
      description?: string | undefined;
    },
  ): Promise<HostedWorkflowMetadata> {
    const response = await requestWithFallback("/api/chatkit/hosted", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    const data = normalizeHostedWorkflowMetadata(
      (await response.json()) as HostedWorkflowApiEntry,
    );
    hostedWorkflowCache = undefined;
    return data;
  },

  async deleteHostedWorkflow(token: string | null, slug: string): Promise<void> {
    await requestWithFallback(`/api/chatkit/hosted/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
    hostedWorkflowCache = undefined;
  },

  invalidateHostedWorkflowCache(): void {
    hostedWorkflowCache = undefined;
    hostedWorkflowPromise = null;
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

export type DocumentationMetadata = {
  slug: string;
  title: string | null;
  summary: string | null;
  language: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentationEntry = DocumentationMetadata & {
  content_markdown: string | null;
  metadata: Record<string, unknown>;
};

export type DocumentationCreatePayload = {
  slug: string;
  title?: string | null;
  summary?: string | null;
  language?: string | null;
  content_markdown?: string | null;
  metadata?: Record<string, unknown>;
};

export type DocumentationUpdatePayload = {
  title?: string | null;
  summary?: string | null;
  language?: string | null;
  content_markdown?: string | null;
  metadata?: Record<string, unknown> | null;
};

const buildDocsPath = (path: string, params?: URLSearchParams): string => {
  if (!params || Array.from(params.entries()).length === 0) {
    return path;
  }
  return `${path}?${params.toString()}`;
};

export const docsApi = {
  async list(
    token: string | null,
    options?: { language?: string | null },
  ): Promise<DocumentationMetadata[]> {
    const params = new URLSearchParams();
    if (options?.language) {
      params.set("language", options.language);
    }

    const response = await requestWithFallback(buildDocsPath("/api/docs", params), {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async get(token: string | null, slug: string): Promise<DocumentationEntry> {
    const response = await requestWithFallback(`/api/docs/${encodeURIComponent(slug)}`, {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async create(
    token: string | null,
    payload: DocumentationCreatePayload,
  ): Promise<DocumentationEntry> {
    const response = await requestWithFallback("/api/docs", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async update(
    token: string | null,
    slug: string,
    payload: DocumentationUpdatePayload,
  ): Promise<DocumentationEntry> {
    const response = await requestWithFallback(`/api/docs/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async delete(token: string | null, slug: string): Promise<void> {
    await requestWithFallback(`/api/docs/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
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
  provider_id: string | null;
  provider_slug: string | null;
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
  provider_id?: string | null;
  provider_slug?: string | null;
  supports_reasoning: boolean;
};

export type AvailableModelUpdatePayload = {
  name?: string;
  display_name?: string | null;
  description?: string | null;
  provider_id?: string | null;
  provider_slug?: string | null;
  supports_reasoning?: boolean;
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

  async update(
    token: string | null,
    id: number,
    payload: AvailableModelUpdatePayload,
  ): Promise<AvailableModel> {
    const response = await requestWithFallback(`/api/admin/models/${id}`, {
      method: "PATCH",
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

export type WorkflowVersionSummary = {
  id: number;
  workflow_id: number;
  name: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkflowVersionResponse = {
  id: number;
  workflow_id: number;
  name: string | null;
  version: number;
  is_active: boolean;
  definition: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreateWorkflowPayload = {
  slug: string;
  display_name: string;
  description?: string | null;
};

export type CreateWorkflowWithGraphPayload = {
  slug: string;
  display_name: string;
  description?: string | null;
  graph: Record<string, unknown> | null;
};

export type UpdateWorkflowPayload = {
  display_name?: string;
  description?: string | null;
};

export const workflowsApi = {
  async list(token: string | null): Promise<WorkflowSummary[]> {
    const response = await requestWithFallback("/api/workflows", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async create(token: string | null, payload: CreateWorkflowPayload): Promise<WorkflowSummary> {
    const response = await requestWithFallback("/api/workflows", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async createWithGraph(token: string | null, payload: CreateWorkflowWithGraphPayload): Promise<WorkflowVersionResponse> {
    const response = await requestWithFallback("/api/workflows", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async update(token: string | null, id: number, payload: UpdateWorkflowPayload): Promise<WorkflowSummary> {
    const response = await requestWithFallback(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async delete(token: string | null, id: number): Promise<void> {
    await requestWithFallback(`/api/workflows/${id}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
  },

  async duplicate(token: string | null, id: number, newName: string): Promise<WorkflowSummary> {
    const response = await requestWithFallback(`/api/workflows/${id}/duplicate`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ display_name: newName }),
    });
    return response.json();
  },

  async getVersions(token: string | null, workflowId: number): Promise<WorkflowVersionSummary[]> {
    const response = await requestWithFallback(`/api/workflows/${workflowId}/versions`, {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async getVersion(token: string | null, versionId: number): Promise<WorkflowVersionResponse> {
    const response = await requestWithFallback(`/api/workflow_versions/${versionId}`, {
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

  async promoteVersion(
    token: string | null,
    versionId: number,
    isActive: boolean,
  ): Promise<WorkflowVersionResponse> {
    const response = await requestWithFallback(`/workflow_versions/${versionId}/promote`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ is_active: isActive }),
    });
    return response.json();
  },

  async deployToProduction(
    token: string | null,
    workflowId: number,
    versionId: number,
  ): Promise<WorkflowVersionResponse> {
    const response = await requestWithFallback(`/api/workflows/${workflowId}/production`, {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify({ version_id: versionId }),
    });
    return response.json();
  },
};

export type VectorStoreSummary = {
  slug: string;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  documents_count: number;
};

export const WORKFLOW_VECTOR_STORE_SLUG = "chatkit-workflows";
export const PROTECTED_VECTOR_STORE_ERROR_MESSAGE =
  "Ce vector store est protégé et ne peut pas être supprimé.";

export type VectorStoreCreatePayload = {
  slug: string;
  title?: string | null;
  description?: string | null;
  metadata: Record<string, unknown>;
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
    try {
      await requestWithFallback(`/api/vector-stores/${slug}`, {
        method: "DELETE",
        headers: withAuthHeaders(token),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        if (slug === WORKFLOW_VECTOR_STORE_SLUG) {
          const detail =
            typeof error.detail === "string"
              ? error.detail
              : PROTECTED_VECTOR_STORE_ERROR_MESSAGE;
          throw new Error(detail);
        }
      }
      throw error;
    }
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

// ========== SIP Accounts ==========

export interface SipAccount {
  id: number;
  label: string;
  trunk_uri: string;
  username: string | null;
  password: string | null;
  contact_host: string | null;
  contact_port: number | null;
  contact_transport: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SipAccountPayload {
  label: string;
  trunk_uri: string;
  username?: string | null;
  password?: string | null;
  contact_host?: string | null;
  contact_port?: number | null;
  contact_transport?: string | null;
  is_default: boolean;
  is_active: boolean;
}

export type SipAccountUpdatePayload = Partial<SipAccountPayload>;

export const sipAccountsApi = {
  async list(token: string | null): Promise<SipAccount[]> {
    const response = await requestWithFallback("/api/admin/sip-accounts", {
      headers: withAuthHeaders(token),
    });
    return response.json();
  },

  async create(token: string | null, payload: SipAccountPayload): Promise<SipAccount> {
    const response = await requestWithFallback("/api/admin/sip-accounts", {
      method: "POST",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async update(
    token: string | null,
    id: number,
    payload: SipAccountUpdatePayload,
  ): Promise<SipAccount> {
    const response = await requestWithFallback(`/api/admin/sip-accounts/${id}`, {
      method: "PATCH",
      headers: withAuthHeaders(token),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async delete(token: string | null, id: number): Promise<void> {
    await requestWithFallback(`/api/admin/sip-accounts/${id}`, {
      method: "DELETE",
      headers: withAuthHeaders(token),
    });
  },
};
