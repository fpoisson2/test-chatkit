export type AgentParameters = Record<string, unknown>;

export type ImageGenerationToolConfig = {
  model: string;
  size?: string;
  quality?: string;
  background?: string;
  output_format?: string;
};

export type ComputerUseConfig = {
  display_width: number;
  display_height: number;
  environment: string;
  start_url?: string;
};

export type WorkflowToolConfig = {
  slug: string;
  name?: string;
  description?: string;
  title?: string;
  identifier?: string;
  workflowId?: number | null;
  showUi?: boolean;
  initialMessage?: string;
};

export type AgentMcpTransport = "hosted" | "http" | "sse" | "stdio";

export type AgentMcpRequireApprovalMode = "always" | "never" | "custom";

export type AgentMcpCredentialStatus = "disconnected" | "pending" | "connected";

export type AgentMcpToolConfig = {
  id: string;
  transport: AgentMcpTransport;
  serverLabel: string;
  serverUrl: string;
  connectorId: string;
  authorization: string;
  headersText: string;
  allowedToolsText: string;
  requireApprovalMode: AgentMcpRequireApprovalMode;
  requireApprovalCustom: string;
  description: string;
  url: string;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  credentialId: number | null;
  credentialLabel: string;
  credentialHint: string;
  credentialStatus: AgentMcpCredentialStatus;
  credentialAuthType: "api_key" | "oauth" | null;
};

export type AgentMcpToolValidation = {
  id: string;
  errors: {
    serverLabel?: "missing";
    connection?: "missingTarget" | "missingUrl" | "missingCommand";
    headers?: "invalid";
    env?: "invalid";
    allowedTools?: "invalid";
    requireApproval?: "invalid";
  };
};

export const DEFAULT_END_MESSAGE = "Workflow terminé";

export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const stringifyAgentParameters = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters || Object.keys(parameters).length === 0) {
    return "{}";
  }
  return JSON.stringify(parameters, null, 2);
};

export const parseAgentParameters = (rawValue: string): AgentParameters => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Les paramètres doivent être un objet JSON");
    }
    return parsed as AgentParameters;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Paramètres JSON invalides : ${error.message}`);
    }
    throw new Error("Paramètres JSON invalides");
  }
};

const stripEmpty = (value: Record<string, unknown>): AgentParameters => {
  if (Object.keys(value).length === 0) {
    return {};
  }
  return value;
};

const sanitizeWorkflowReference = (
  reference: Record<string, unknown>,
): { id: number | null; slug: string } => {
  const rawId = reference.id;
  const id = typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const rawSlug = reference.slug;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  return { id, slug };
};

export const getAgentNestedWorkflow = (
  parameters: AgentParameters | null | undefined,
): { id: number | null; slug: string } => {
  if (!parameters) {
    return { id: null, slug: "" };
  }
  const reference = (parameters as Record<string, unknown>).workflow;
  if (isPlainRecord(reference)) {
    return sanitizeWorkflowReference(reference as Record<string, unknown>);
  }
  return { id: null, slug: "" };
};

export const setAgentNestedWorkflow = (
  parameters: AgentParameters,
  reference: { id?: number | null; slug?: string | null },
): AgentParameters => {
  const next = { ...parameters } as Record<string, unknown>;
  const idCandidate = reference.id;
  const slugCandidate = reference.slug;

  const hasId = typeof idCandidate === "number" && Number.isInteger(idCandidate) && idCandidate > 0;
  const slug = typeof slugCandidate === "string" ? slugCandidate.trim() : "";

  if (!hasId && !slug) {
    delete next.workflow;
    return stripEmpty(next);
  }

  const payload: Record<string, unknown> = {};
  if (hasId && typeof idCandidate === "number") {
    payload.id = idCandidate;
  }
  if (slug) {
    payload.slug = slug;
  }

  next.workflow = payload;
  return stripEmpty(next);
};

export const getEndMessage = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const message = parameters.message;
  if (typeof message === "string") {
    return message;
  }
  const status = parameters.status;
  if (isPlainRecord(status)) {
    const reason = (status as Record<string, unknown>).reason;
    if (typeof reason === "string") {
      return reason;
    }
  }
  const fallback = parameters.status_reason ?? parameters.reason;
  return typeof fallback === "string" ? fallback : "";
};

export const getAssistantMessage = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const params = parameters as Record<string, unknown>;
  const message = params.message;
  if (typeof message === "string") {
    return message;
  }
  const text = params.text;
  if (typeof text === "string") {
    return text;
  }
  const status = params.status;
  if (isPlainRecord(status)) {
    const reason = (status as Record<string, unknown>).reason;
    if (typeof reason === "string") {
      return reason;
    }
  }
  return "";
};

export const getAssistantMessageStreamEnabled = (
  parameters: AgentParameters | null | undefined,
): boolean => {
  if (!parameters) {
    return false;
  }
  const rawValue = (parameters as Record<string, unknown>).simulate_stream;
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "number") {
    return rawValue !== 0;
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (truthyStrings.has(normalized)) {
      return true;
    }
    if (falsyStrings.has(normalized)) {
      return false;
    }
  }
  return false;
};

const DEFAULT_ASSISTANT_STREAM_DELAY_MS = 30;

export const getAssistantMessageStreamDelay = (
  parameters: AgentParameters | null | undefined,
): number => {
  if (!parameters) {
    return DEFAULT_ASSISTANT_STREAM_DELAY_MS;
  }
  const rawValue = (parameters as Record<string, unknown>).simulate_stream_delay_ms;
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return Math.max(0, Math.round(rawValue));
  }
  if (typeof rawValue === "string") {
    const parsed = Number(rawValue.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return DEFAULT_ASSISTANT_STREAM_DELAY_MS;
};

export const getWaitForUserInputMessage = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const params = parameters as Record<string, unknown>;
  const message = params.message;
  if (typeof message === "string") {
    return message;
  }
  const text = params.text;
  if (typeof text === "string") {
    return text;
  }
  return "";
};

export const getUserMessage = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const params = parameters as Record<string, unknown>;
  const message = params.message;
  if (typeof message === "string") {
    return message;
  }
  const text = params.text;
  if (typeof text === "string") {
    return text;
  }
  return "";
};

const truthyStrings = new Set(["true", "1", "yes", "on"]);
const falsyStrings = new Set(["false", "0", "no", "off"]);

const coerceBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (truthyStrings.has(normalized)) {
      return true;
    }
    if (falsyStrings.has(normalized)) {
      return false;
    }
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
};

export const getStartAutoRun = (
  parameters: AgentParameters | null | undefined,
): boolean => {
  if (!parameters) {
    return false;
  }
  const rawValue =
    (parameters as Record<string, unknown>).auto_start ??
    (parameters as Record<string, unknown>).start_automatically;
  return coerceBoolean(rawValue);
};

export const getStartAutoRunMessage = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const message = (parameters as Record<string, unknown>).auto_start_user_message;
  return typeof message === "string" ? message : "";
};

export const getStartAutoRunAssistantMessage = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const message = (parameters as Record<string, unknown>).auto_start_assistant_message;
  return typeof message === "string" ? message : "";
};

export const getConditionPath = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const path = (parameters as Record<string, unknown>).path;
  return typeof path === "string" ? path : "";
};

export const getConditionMode = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "truthy";
  }
  const mode = (parameters as Record<string, unknown>).mode;
  return typeof mode === "string" && mode.trim() ? mode : "truthy";
};

export const getConditionValue = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const value = (parameters as Record<string, unknown>).value;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

export const setStartAutoRun = (
  parameters: AgentParameters,
  autoRun: boolean,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  delete (next as Record<string, unknown>).start_automatically;
  if (autoRun) {
    (next as Record<string, unknown>).auto_start = true;
  } else {
    delete (next as Record<string, unknown>).auto_start;
  }
  return stripEmpty(next as Record<string, unknown>);
};

export const setStartAutoRunMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = message.trim();

  if (!trimmed) {
    delete (next as Record<string, unknown>).auto_start_user_message;
    return stripEmpty(next as Record<string, unknown>);
  }

  delete (next as Record<string, unknown>).auto_start_assistant_message;
  (next as Record<string, unknown>).auto_start_user_message = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const setStartAutoRunAssistantMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = message.trim();

  if (!trimmed) {
    delete (next as Record<string, unknown>).auto_start_assistant_message;
    return stripEmpty(next as Record<string, unknown>);
  }

  delete (next as Record<string, unknown>).auto_start_user_message;
  (next as Record<string, unknown>).auto_start_assistant_message = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

const cloneStartTelephonyConfig = (
  value: unknown,
): Record<string, unknown> => {
  if (!isPlainRecord(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
};

const updateStartTelephonyConfig = (
  parameters: AgentParameters,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): AgentParameters => {
  const base = { ...parameters } as Record<string, unknown>;
  const current = cloneStartTelephonyConfig((base as Record<string, unknown>).telephony);
  const updated = updater(current);

  if (Object.keys(updated).length === 0) {
    delete base.telephony;
    return stripEmpty(base);
  }

  base.telephony = updated;
  return stripEmpty(base);
};

export const getStartTelephonyRoutes = (
  parameters: AgentParameters | null | undefined,
): string[] => {
  if (!parameters) {
    return [];
  }

  const telephony = cloneStartTelephonyConfig(
    (parameters as Record<string, unknown>).telephony,
  );

  const routes = telephony.routes;
  if (!Array.isArray(routes)) {
    return [];
  }

  const normalized: string[] = [];
  for (const entry of routes) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    normalized.push(trimmed);
  }

  return normalized;
};

export const setStartTelephonyRoutes = (
  parameters: AgentParameters,
  routes: string[],
): AgentParameters => {
  const normalized = Array.from(
    new Set(
      routes
        .map((route) => route.trim())
        .filter((route) => route.length > 0),
    ),
  );

  return updateStartTelephonyConfig(parameters, (current) => {
    if (normalized.length === 0) {
      const { routes: _ignored, ...rest } = current;
      return rest;
    }
    return { ...current, routes: normalized };
  });
};

export type StartTelephonyWorkflowReference = { id: number | null; slug: string };

export const getStartTelephonyWorkflow = (
  parameters: AgentParameters | null | undefined,
): StartTelephonyWorkflowReference => {
  if (!parameters) {
    return { id: null, slug: "" };
  }

  const telephony = cloneStartTelephonyConfig(
    (parameters as Record<string, unknown>).telephony,
  );
  const workflow = telephony.workflow;
  if (isPlainRecord(workflow)) {
    return sanitizeWorkflowReference(workflow as Record<string, unknown>);
  }

  return { id: null, slug: "" };
};

export const setStartTelephonyWorkflow = (
  parameters: AgentParameters,
  reference: { id?: number | null; slug?: string | null },
): AgentParameters =>
  updateStartTelephonyConfig(parameters, (current) => {
    const idCandidate = reference.id;
    const slugCandidate = reference.slug;

    const hasId =
      typeof idCandidate === "number" &&
      Number.isInteger(idCandidate) &&
      idCandidate > 0;
    const slug = typeof slugCandidate === "string" ? slugCandidate.trim() : "";

    if (!hasId && !slug) {
      const { workflow: _ignored, ...rest } = current;
      return rest;
    }

    const payload: Record<string, unknown> = {};
    if (hasId && typeof idCandidate === "number") {
      payload.id = idCandidate;
    }
    if (slug) {
      payload.slug = slug;
    }

    return { ...current, workflow: payload };
  });

export const setConditionPath = (
  parameters: AgentParameters,
  path: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = path.trim();
  if (!trimmed) {
    delete (next as Record<string, unknown>).path;
    return stripEmpty(next as Record<string, unknown>);
  }
  (next as Record<string, unknown>).path = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const setConditionMode = (
  parameters: AgentParameters,
  mode: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = mode.trim();
  if (!trimmed) {
    delete (next as Record<string, unknown>).mode;
    return stripEmpty(next as Record<string, unknown>);
  }
  (next as Record<string, unknown>).mode = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const setConditionValue = (
  parameters: AgentParameters,
  value: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = value.trim();
  if (!trimmed) {
    delete (next as Record<string, unknown>).value;
    return stripEmpty(next as Record<string, unknown>);
  }
  (next as Record<string, unknown>).value = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const setEndMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = message.trim();

  if (!trimmed) {
    delete next.message;
    const status = isPlainRecord(next.status)
      ? { ...(next.status as Record<string, unknown>) }
      : null;
    if (status) {
      delete status.reason;
      if (typeof status.type !== "string" || !status.type.trim()) {
        delete status.type;
      }
      if (Object.keys(status).length === 0) {
        delete next.status;
      } else {
        next.status = status;
      }
    } else {
      delete next.status;
    }
    if (typeof next.reason === "string") {
      delete next.reason;
    }
    if (typeof next.status_reason === "string") {
      delete next.status_reason;
    }
    return stripEmpty(next as Record<string, unknown>);
  }

  next.message = message;
  const status = isPlainRecord(next.status)
    ? { ...(next.status as Record<string, unknown>) }
    : {};
  status.reason = message;
  if (typeof status.type !== "string" || !status.type.trim()) {
    status.type = "closed";
  }
  next.status = status;

  return stripEmpty(next as Record<string, unknown>);
};

export const setAssistantMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = message.trim();

  if (!trimmed) {
    delete (next as Record<string, unknown>).message;
    delete (next as Record<string, unknown>).text;
    delete (next as Record<string, unknown>).simulate_stream;
    delete (next as Record<string, unknown>).simulate_stream_delay_ms;
    if (isPlainRecord(next.status)) {
      const status = { ...(next.status as Record<string, unknown>) };
      delete status.reason;
      if (Object.keys(status).length === 0) {
        delete (next as Record<string, unknown>).status;
      } else {
        (next as Record<string, unknown>).status = status;
      }
    }
    return stripEmpty(next as Record<string, unknown>);
  }

  (next as Record<string, unknown>).message = message;
  return stripEmpty(next as Record<string, unknown>);
};

export const setAssistantMessageStreamEnabled = (
  parameters: AgentParameters,
  enabled: boolean,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  if (enabled) {
    (next as Record<string, unknown>).simulate_stream = true;
    return stripEmpty(next as Record<string, unknown>);
  }
  delete (next as Record<string, unknown>).simulate_stream;
  return stripEmpty(next as Record<string, unknown>);
};

export const setAssistantMessageStreamDelay = (
  parameters: AgentParameters,
  delayMs: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const normalized = delayMs.trim();
  if (!normalized) {
    delete (next as Record<string, unknown>).simulate_stream_delay_ms;
    return stripEmpty(next as Record<string, unknown>);
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    delete (next as Record<string, unknown>).simulate_stream_delay_ms;
    return stripEmpty(next as Record<string, unknown>);
  }
  (next as Record<string, unknown>).simulate_stream_delay_ms = Math.round(parsed);
  return stripEmpty(next as Record<string, unknown>);
};

export const setUserMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = message.trim();

  if (!trimmed) {
    delete (next as Record<string, unknown>).message;
    delete (next as Record<string, unknown>).text;
    return stripEmpty(next as Record<string, unknown>);
  }

  (next as Record<string, unknown>).message = message;
  return stripEmpty(next as Record<string, unknown>);
};

export const setWaitForUserInputMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = message.trim();

  if (!trimmed) {
    delete (next as Record<string, unknown>).message;
    delete (next as Record<string, unknown>).text;
    return stripEmpty(next as Record<string, unknown>);
  }

  (next as Record<string, unknown>).message = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const getAgentMessage = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const instructions = parameters.instructions;
  return typeof instructions === "string" ? instructions : "";
};

export const getAgentModel = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const model = parameters.model;
  return typeof model === "string" ? model : "";
};

export const getAgentModelProviderId = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const value = (parameters as Record<string, unknown>).model_provider_id;
  return typeof value === "string" ? value : "";
};

export const getAgentModelProviderSlug = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const value = (parameters as Record<string, unknown>).model_provider_slug;
  if (typeof value === "string") {
    return value;
  }
  const legacy = (parameters as Record<string, unknown>).model_provider;
  return typeof legacy === "string" ? legacy : "";
};

export const getAgentReasoningEffort = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return "";
  }
  const reasoning = modelSettings.reasoning;
  if (!isPlainRecord(reasoning)) {
    return "";
  }
  const effort = reasoning.effort;
  return typeof effort === "string" ? effort : "";
};

export const getAgentTextVerbosity = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return "";
  }
  const text = modelSettings.text;
  if (!isPlainRecord(text)) {
    return "";
  }
  const verbosity = text.verbosity;
  return typeof verbosity === "string" ? verbosity : "";
};

export const setAgentMessage = (
  parameters: AgentParameters,
  message: string,
): AgentParameters => {
  const trimmed = message.trim();
  const next = { ...parameters } as AgentParameters;
  if (!trimmed) {
    const { instructions: _ignored, ...rest } = next;
    return stripEmpty(rest);
  }
  return { ...next, instructions: message };
};

export const setAgentModel = (parameters: AgentParameters, model: string): AgentParameters => {
  const trimmed = model.trim();
  const next = { ...parameters } as AgentParameters;
  if (!trimmed) {
    const { model: _ignored, ...rest } = next;
    return stripEmpty(rest);
  }
  return { ...next, model: trimmed };
};

export const setAgentModelProvider = (
  parameters: AgentParameters,
  selection: { providerId?: string | null; providerSlug?: string | null },
): AgentParameters => {
  const next = { ...(parameters as Record<string, unknown>) };
  const providerId = selection.providerId?.toString().trim() ?? "";
  const providerSlug = selection.providerSlug?.toString().trim().toLowerCase() ?? "";

  if (!providerId && !providerSlug) {
    delete next.model_provider_id;
    delete next.model_provider_slug;
    delete next.model_provider;
    return stripEmpty(next);
  }

  if (providerId) {
    next.model_provider_id = providerId;
  } else {
    delete next.model_provider_id;
  }

  if (providerSlug) {
    next.model_provider_slug = providerSlug;
    next.model_provider = providerSlug;
  } else {
    delete next.model_provider_slug;
    delete next.model_provider;
  }

  return stripEmpty(next);
};

export const VOICE_AGENT_TOOL_KEYS = [
  "response",
  "transcription",
  "function_call",
] as const;

export type VoiceAgentTool = (typeof VOICE_AGENT_TOOL_KEYS)[number];
export type VoiceAgentStartBehavior = "manual" | "auto";
export type VoiceAgentStopBehavior = "manual" | "auto";

export const DEFAULT_VOICE_AGENT_MODEL = "gpt-4o-realtime-preview";
export const DEFAULT_VOICE_AGENT_VOICE = "alloy";
export const DEFAULT_VOICE_AGENT_START_BEHAVIOR: VoiceAgentStartBehavior = "manual";
export const DEFAULT_VOICE_AGENT_STOP_BEHAVIOR: VoiceAgentStopBehavior = "auto";

const VOICE_AGENT_TOOL_DEFAULTS: Record<VoiceAgentTool, boolean> = {
  response: true,
  transcription: true,
  function_call: false,
};

const isVoiceAgentStartBehavior = (value: unknown): value is VoiceAgentStartBehavior =>
  value === "manual" || value === "auto";

const isVoiceAgentStopBehavior = (value: unknown): value is VoiceAgentStopBehavior =>
  value === "manual" || value === "auto";

const coerceVoiceBoolean = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return coerceBoolean(value);
};

const cleanupVoiceRealtimeConfig = (
  config: Record<string, unknown>,
): Record<string, unknown> => {
  const next = { ...config } as Record<string, unknown>;

  const tools = isPlainRecord(next.tools)
    ? { ...(next.tools as Record<string, unknown>) }
    : {};

  const normalizedTools: Record<VoiceAgentTool, boolean> = {
    response: coerceVoiceBoolean(tools.response, VOICE_AGENT_TOOL_DEFAULTS.response),
    transcription: coerceVoiceBoolean(
      tools.transcription,
      VOICE_AGENT_TOOL_DEFAULTS.transcription,
    ),
    function_call: coerceVoiceBoolean(
      tools.function_call,
      VOICE_AGENT_TOOL_DEFAULTS.function_call,
    ),
  };

  next.tools = normalizedTools;

  const startMode = next.start_mode;
  next.start_mode = isVoiceAgentStartBehavior(startMode)
    ? startMode
    : DEFAULT_VOICE_AGENT_START_BEHAVIOR;

  const stopMode = next.stop_mode;
  next.stop_mode = isVoiceAgentStopBehavior(stopMode)
    ? stopMode
    : DEFAULT_VOICE_AGENT_STOP_BEHAVIOR;

  return next;
};

const updateVoiceRealtimeConfig = (
  parameters: AgentParameters,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): AgentParameters => {
  const base = { ...parameters } as Record<string, unknown>;
  const current = isPlainRecord(base.realtime)
    ? { ...(base.realtime as Record<string, unknown>) }
    : {};
  const updated = cleanupVoiceRealtimeConfig(updater(current));

  if (Object.keys(updated).length === 0) {
    delete base.realtime;
  } else {
    base.realtime = updated;
  }

  return stripEmpty(base);
};

export const createVoiceAgentParameters = (): AgentParameters => ({
  model: DEFAULT_VOICE_AGENT_MODEL,
  voice: DEFAULT_VOICE_AGENT_VOICE,
  realtime: {
    start_mode: DEFAULT_VOICE_AGENT_START_BEHAVIOR,
    stop_mode: DEFAULT_VOICE_AGENT_STOP_BEHAVIOR,
    tools: {
      response: VOICE_AGENT_TOOL_DEFAULTS.response,
      transcription: VOICE_AGENT_TOOL_DEFAULTS.transcription,
      function_call: VOICE_AGENT_TOOL_DEFAULTS.function_call,
    },
  },
});

export const getVoiceAgentVoice = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return DEFAULT_VOICE_AGENT_VOICE;
  }
  const voice = (parameters as Record<string, unknown>).voice;
  if (typeof voice === "string" && voice.trim()) {
    return voice.trim();
  }
  return DEFAULT_VOICE_AGENT_VOICE;
};

export const setVoiceAgentVoice = (
  parameters: AgentParameters,
  voice: string,
): AgentParameters => {
  const next = { ...parameters } as Record<string, unknown>;
  const normalized = voice.trim() || DEFAULT_VOICE_AGENT_VOICE;
  next.voice = normalized;
  return stripEmpty(next);
};

export const getVoiceAgentStartBehavior = (
  parameters: AgentParameters | null | undefined,
): VoiceAgentStartBehavior => {
  if (!parameters) {
    return DEFAULT_VOICE_AGENT_START_BEHAVIOR;
  }
  const realtime = (parameters as Record<string, unknown>).realtime;
  if (!isPlainRecord(realtime)) {
    return DEFAULT_VOICE_AGENT_START_BEHAVIOR;
  }
  const startMode = (realtime as Record<string, unknown>).start_mode;
  return isVoiceAgentStartBehavior(startMode)
    ? startMode
    : DEFAULT_VOICE_AGENT_START_BEHAVIOR;
};

export const setVoiceAgentStartBehavior = (
  parameters: AgentParameters,
  behavior: VoiceAgentStartBehavior,
): AgentParameters =>
  updateVoiceRealtimeConfig(parameters, (current) => ({
    ...current,
    start_mode: isVoiceAgentStartBehavior(behavior)
      ? behavior
      : DEFAULT_VOICE_AGENT_START_BEHAVIOR,
  }));

export const getVoiceAgentStopBehavior = (
  parameters: AgentParameters | null | undefined,
): VoiceAgentStopBehavior => {
  if (!parameters) {
    return DEFAULT_VOICE_AGENT_STOP_BEHAVIOR;
  }
  const realtime = (parameters as Record<string, unknown>).realtime;
  if (!isPlainRecord(realtime)) {
    return DEFAULT_VOICE_AGENT_STOP_BEHAVIOR;
  }
  const stopMode = (realtime as Record<string, unknown>).stop_mode;
  return isVoiceAgentStopBehavior(stopMode)
    ? stopMode
    : DEFAULT_VOICE_AGENT_STOP_BEHAVIOR;
};

export const setVoiceAgentStopBehavior = (
  parameters: AgentParameters,
  behavior: VoiceAgentStopBehavior,
): AgentParameters =>
  updateVoiceRealtimeConfig(parameters, (current) => ({
    ...current,
    stop_mode: isVoiceAgentStopBehavior(behavior)
      ? behavior
      : DEFAULT_VOICE_AGENT_STOP_BEHAVIOR,
  }));

export const getVoiceAgentTools = (
  parameters: AgentParameters | null | undefined,
): Record<VoiceAgentTool, boolean> => {
  if (!parameters) {
    return {
      response: VOICE_AGENT_TOOL_DEFAULTS.response,
      transcription: VOICE_AGENT_TOOL_DEFAULTS.transcription,
      function_call: VOICE_AGENT_TOOL_DEFAULTS.function_call,
    };
  }

  const realtime = (parameters as Record<string, unknown>).realtime;
  const tools = isPlainRecord(realtime) && isPlainRecord((realtime as Record<string, unknown>).tools)
    ? ((realtime as Record<string, unknown>).tools as Record<string, unknown>)
    : {};

  return {
    response: coerceVoiceBoolean(tools.response, VOICE_AGENT_TOOL_DEFAULTS.response),
    transcription: coerceVoiceBoolean(
      tools.transcription,
      VOICE_AGENT_TOOL_DEFAULTS.transcription,
    ),
    function_call: coerceVoiceBoolean(
      tools.function_call,
      VOICE_AGENT_TOOL_DEFAULTS.function_call,
    ),
  };
};

export const setVoiceAgentToolEnabled = (
  parameters: AgentParameters,
  tool: VoiceAgentTool,
  enabled: boolean,
): AgentParameters =>
  updateVoiceRealtimeConfig(parameters, (current) => {
    const tools = isPlainRecord(current.tools)
      ? { ...(current.tools as Record<string, unknown>) }
      : {};
    tools[tool] = Boolean(enabled);
    return { ...current, tools };
  });

export type StartTelephonyRealtimeOverrides = {
  model: string;
  voice: string;
  start_mode: VoiceAgentStartBehavior | null;
  stop_mode: VoiceAgentStopBehavior | null;
};

const normalizeTelephonyRealtime = (
  value: unknown,
): Record<string, unknown> => {
  if (!isPlainRecord(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
};

export const getStartTelephonyRealtimeOverrides = (
  parameters: AgentParameters | null | undefined,
): StartTelephonyRealtimeOverrides => {
  if (!parameters) {
    return { model: "", voice: "", start_mode: null, stop_mode: null };
  }

  const telephony = cloneStartTelephonyConfig(
    (parameters as Record<string, unknown>).telephony,
  );
  const realtime = normalizeTelephonyRealtime(telephony.realtime);

  const model = typeof realtime.model === "string" ? realtime.model.trim() : "";
  const voice = typeof realtime.voice === "string" ? realtime.voice.trim() : "";
  const startMode = isVoiceAgentStartBehavior(realtime.start_mode)
    ? (realtime.start_mode as VoiceAgentStartBehavior)
    : null;
  const stopMode = isVoiceAgentStopBehavior(realtime.stop_mode)
    ? (realtime.stop_mode as VoiceAgentStopBehavior)
    : null;

  return { model, voice, start_mode: startMode, stop_mode: stopMode };
};

export const setStartTelephonyRealtimeOverrides = (
  parameters: AgentParameters,
  overrides: Partial<StartTelephonyRealtimeOverrides>,
): AgentParameters =>
  updateStartTelephonyConfig(parameters, (current) => {
    const realtime = normalizeTelephonyRealtime(current.realtime);

    if (Object.prototype.hasOwnProperty.call(overrides, "model")) {
      const modelValue = overrides.model;
      const trimmed = typeof modelValue === "string" ? modelValue.trim() : "";
      if (trimmed) {
        realtime.model = trimmed;
      } else {
        delete realtime.model;
      }
    }

    if (Object.prototype.hasOwnProperty.call(overrides, "voice")) {
      const voiceValue = overrides.voice;
      const trimmed = typeof voiceValue === "string" ? voiceValue.trim() : "";
      if (trimmed) {
        realtime.voice = trimmed;
      } else {
        delete realtime.voice;
      }
    }

    if (Object.prototype.hasOwnProperty.call(overrides, "start_mode")) {
      const startModeValue = overrides.start_mode;
      if (isVoiceAgentStartBehavior(startModeValue)) {
        realtime.start_mode = startModeValue;
      } else {
        delete realtime.start_mode;
      }
    }

    if (Object.prototype.hasOwnProperty.call(overrides, "stop_mode")) {
      const stopModeValue = overrides.stop_mode;
      if (isVoiceAgentStopBehavior(stopModeValue)) {
        realtime.stop_mode = stopModeValue;
      } else {
        delete realtime.stop_mode;
      }
    }

    if (Object.keys(realtime).length === 0) {
      const { realtime: _ignored, ...rest } = current;
      return rest;
    }

    return { ...current, realtime };
  });

export const resolveStartParameters = (
  rawParameters: AgentParameters | null | undefined,
): AgentParameters => {
  const base = isPlainRecord(rawParameters)
    ? ({ ...(rawParameters as AgentParameters) } as AgentParameters)
    : ({} as AgentParameters);

  let result = base;

  result = setStartAutoRun(result, getStartAutoRun(rawParameters));
  result = setStartAutoRunMessage(result, getStartAutoRunMessage(rawParameters));
  result = setStartAutoRunAssistantMessage(
    result,
    getStartAutoRunAssistantMessage(rawParameters),
  );

  result = setStartTelephonyRoutes(result, getStartTelephonyRoutes(rawParameters));
  result = setStartTelephonyWorkflow(result, getStartTelephonyWorkflow(rawParameters));
  result = setStartTelephonyRealtimeOverrides(
    result,
    getStartTelephonyRealtimeOverrides(rawParameters),
  );

  return result;
};

export const resolveVoiceAgentParameters = (
  rawParameters: AgentParameters | null | undefined,
): AgentParameters => {
  const base = isPlainRecord(rawParameters)
    ? ({ ...(rawParameters as AgentParameters) } as AgentParameters)
    : ({} as AgentParameters);

  let result = base;

  result = setAgentModel(result, getAgentModel(rawParameters) || DEFAULT_VOICE_AGENT_MODEL);
  result = setVoiceAgentVoice(result, getVoiceAgentVoice(rawParameters));
  result = setVoiceAgentStartBehavior(result, getVoiceAgentStartBehavior(rawParameters));
  result = setVoiceAgentStopBehavior(result, getVoiceAgentStopBehavior(rawParameters));

  const tools = getVoiceAgentTools(rawParameters);
  for (const tool of VOICE_AGENT_TOOL_KEYS) {
    result = setVoiceAgentToolEnabled(result, tool, tools[tool]);
  }

  const instructions = getAgentMessage(rawParameters);
  result = setAgentMessage(result, instructions);

  return result;
};

export const setAgentReasoningEffort = (
  parameters: AgentParameters,
  effort: string,
): AgentParameters => {
  const trimmed = effort.trim();
  if (!trimmed) {
    return updateModelSettings(parameters, (current) => {
      const { reasoning: _ignored, ...rest } = current;
      return rest;
    });
  }

  return updateModelSettings(parameters, (current) => {
    const reasoning = isPlainRecord(current.reasoning)
      ? { ...(current.reasoning as Record<string, unknown>) }
      : {};
    reasoning.effort = trimmed;
    return {
      ...current,
      reasoning,
    };
  });
};

const cloneReasoningSettings = (
  reasoning: unknown,
): Record<string, unknown> => {
  if (!isPlainRecord(reasoning)) {
    return {};
  }
  return { ...(reasoning as Record<string, unknown>) };
};

const updateReasoningSettings = (
  parameters: AgentParameters,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): AgentParameters =>
  updateModelSettings(parameters, (current) => {
    const updated = updater(cloneReasoningSettings(current.reasoning));
    if (Object.keys(updated).length === 0) {
      const { reasoning: _ignored, ...rest } = current;
      return rest;
    }
    return { ...current, reasoning: updated };
  });

export const getAgentReasoningSummary = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return "";
  }
  const reasoning = modelSettings.reasoning;
  if (!isPlainRecord(reasoning)) {
    return "";
  }
  const summary = reasoning.summary;
  return typeof summary === "string" ? summary : "";
};

export const setAgentReasoningSummary = (
  parameters: AgentParameters,
  value: string,
): AgentParameters => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") {
    return updateReasoningSettings(parameters, (current) => {
      const { summary: _ignored, ...rest } = current;
      return rest;
    });
  }
  return updateReasoningSettings(parameters, (current) => ({
    ...current,
    summary: trimmed,
  }));
};

const cloneModelSettings = (
  modelSettings: unknown,
): Record<string, unknown> | undefined => {
  if (!isPlainRecord(modelSettings)) {
    return undefined;
  }
  return { ...(modelSettings as Record<string, unknown>) };
};

const updateModelSettings = (
  parameters: AgentParameters,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const current = cloneModelSettings(next.model_settings) ?? {};
  const updated = updater(current);
  if (Object.keys(updated).length === 0) {
    const { model_settings: _ignored, ...rest } = next;
    return stripEmpty(rest);
  }
  return { ...next, model_settings: updated };
};

const cloneTextSettings = (
  textSettings: unknown,
): Record<string, unknown> => {
  if (!isPlainRecord(textSettings)) {
    return {};
  }
  return { ...(textSettings as Record<string, unknown>) };
};

const updateTextSettings = (
  parameters: AgentParameters,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): AgentParameters =>
  updateModelSettings(parameters, (current) => {
    const updated = updater(cloneTextSettings(current.text));
    if (Object.keys(updated).length === 0) {
      const { text: _ignored, ...rest } = current;
      return rest;
    }
    return { ...current, text: updated };
  });

export const setAgentTextVerbosity = (
  parameters: AgentParameters,
  value: string,
): AgentParameters => {
  const trimmed = value.trim();
  if (!trimmed) {
    return updateTextSettings(parameters, (current) => {
      const { verbosity: _ignored, ...rest } = current;
      return rest;
    });
  }

  return updateTextSettings(parameters, (current) => ({
    ...current,
    verbosity: trimmed,
  }));
};

const parseNumericSetting = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
};

export const getAgentTemperature = (
  parameters: AgentParameters | null | undefined,
): number | null => {
  if (!parameters) {
    return null;
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return null;
  }
  const temperature = modelSettings.temperature;
  return typeof temperature === "number" ? temperature : null;
};

export const setAgentTemperature = (
  parameters: AgentParameters,
  rawValue: string,
): AgentParameters => {
  const parsed = parseNumericSetting(rawValue);
  if (parsed === null) {
    return updateModelSettings(parameters, (current) => {
      const { temperature: _ignored, ...rest } = current;
      return rest;
    });
  }

  return updateModelSettings(parameters, (current) => ({
    ...current,
    temperature: parsed,
  }));
};

export const getAgentTopP = (parameters: AgentParameters | null | undefined): number | null => {
  if (!parameters) {
    return null;
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return null;
  }
  const topP = modelSettings.top_p;
  return typeof topP === "number" ? topP : null;
};

export const setAgentTopP = (
  parameters: AgentParameters,
  rawValue: string,
): AgentParameters => {
  const parsed = parseNumericSetting(rawValue);
  if (parsed === null) {
    return updateModelSettings(parameters, (current) => {
      const { top_p: _ignored, ...rest } = current;
      return rest;
    });
  }

  return updateModelSettings(parameters, (current) => ({
    ...current,
    top_p: parsed,
  }));
};

export const getAgentMaxOutputTokens = (
  parameters: AgentParameters | null | undefined,
): number | null => {
  if (!parameters) {
    return null;
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return null;
  }
  const value = modelSettings.max_output_tokens;
  return typeof value === "number" ? value : null;
};

export const setAgentMaxOutputTokens = (
  parameters: AgentParameters,
  rawValue: string,
): AgentParameters => {
  const parsed = parseNumericSetting(rawValue);
  if (parsed === null) {
    return updateModelSettings(parameters, (current) => {
      const { max_output_tokens: _ignored, ...rest } = current;
      return rest;
    });
  }

  return updateModelSettings(parameters, (current) => ({
    ...current,
    max_output_tokens: parsed,
  }));
};

const getBooleanSetting = (
  parameters: AgentParameters | null | undefined,
  key: string,
  defaultValue: boolean,
): boolean => {
  if (!parameters) {
    return defaultValue;
  }
  const modelSettings = parameters.model_settings;
  if (!isPlainRecord(modelSettings)) {
    return defaultValue;
  }
  const value = (modelSettings as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : defaultValue;
};

const setBooleanSetting = (
  parameters: AgentParameters,
  key: string,
  value: boolean,
): AgentParameters =>
  updateModelSettings(parameters, (current) => ({
    ...current,
    [key]: value,
  }));

export const getAgentIncludeChatHistory = (
  parameters: AgentParameters | null | undefined,
): boolean => getBooleanSetting(parameters, "include_chat_history", true);

export const setAgentIncludeChatHistory = (
  parameters: AgentParameters,
  value: boolean,
): AgentParameters => setBooleanSetting(parameters, "include_chat_history", value);

export const getAgentDisplayResponseInChat = (
  parameters: AgentParameters | null | undefined,
): boolean => getBooleanSetting(parameters, "response_in_chat", true);

export const setAgentDisplayResponseInChat = (
  parameters: AgentParameters,
  value: boolean,
): AgentParameters => setBooleanSetting(parameters, "response_in_chat", value);

export const getAgentShowSearchSources = (
  parameters: AgentParameters | null | undefined,
): boolean => getBooleanSetting(parameters, "show_search_sources", false);

export const setAgentShowSearchSources = (
  parameters: AgentParameters,
  value: boolean,
): AgentParameters => setBooleanSetting(parameters, "show_search_sources", value);

export const getAgentContinueOnError = (
  parameters: AgentParameters | null | undefined,
): boolean => getBooleanSetting(parameters, "continue_on_error", false);

export const setAgentContinueOnError = (
  parameters: AgentParameters,
  value: boolean,
): AgentParameters => setBooleanSetting(parameters, "continue_on_error", value);

export const getAgentStorePreference = (
  parameters: AgentParameters | null | undefined,
): boolean => getBooleanSetting(parameters, "store", true);

export const setAgentStorePreference = (
  parameters: AgentParameters,
  value: boolean | null,
): AgentParameters => {
  if (value == null) {
    return updateModelSettings(parameters, (current) => {
      const { store: _ignored, ...rest } = current;
      return rest;
    });
  }
  return setBooleanSetting(parameters, "store", value);
};

export type WidgetSource = "library" | "variable";

export type AgentResponseFormat =
  | { kind: "text" }
  | { kind: "json_schema"; name: string; schema: unknown }
  | { kind: "widget"; source: "library"; slug: string; variables: Record<string, string> }
  | { kind: "widget"; source: "variable"; definitionExpression: string };

const DEFAULT_SCHEMA_NAME = "workflow_output";
const DEFAULT_JSON_SCHEMA = { type: "object", properties: {} } as const;

const sanitizeSchemaName = (value: string): string => {
  const trimmed = value.trim();
  return trimmed || DEFAULT_SCHEMA_NAME;
};

const buildJsonSchemaFormat = (
  name: string,
  schema: unknown,
): { type: "json_schema"; name: string; schema: unknown; strict: true } => ({
  type: "json_schema",
  name: sanitizeSchemaName(name),
  schema: schema ?? {},
  strict: true,
});

const sanitizeWidgetVariables = (
  variables: unknown,
): Record<string, string> => {
  if (!isPlainRecord(variables)) {
    return {};
  }
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) {
      continue;
    }
    entries.push([trimmedKey, trimmedValue]);
  }
  return Object.fromEntries(entries);
};

export const getAgentResponseFormat = (
  parameters: AgentParameters | null | undefined,
): AgentResponseFormat => {
  if (!parameters) {
    return { kind: "text" };
  }

  const widget = (parameters as Record<string, unknown>).response_widget;
  if (typeof widget === "string") {
    const slug = widget.trim();
    if (slug) {
      return { kind: "widget", source: "library", slug, variables: {} };
    }
  } else if (isPlainRecord(widget)) {
    const rawSource = typeof widget.source === "string" ? widget.source.trim().toLowerCase() : "";
    const definitionExpressionRaw = widget.definition_expression;
    const definitionExpression =
      typeof definitionExpressionRaw === "string" ? definitionExpressionRaw.trim() : "";

    // Si la source est explicitement définie, la respecter
    if (rawSource === "variable") {
      if (definitionExpression) {
        return {
          kind: "widget",
          source: "variable",
          definitionExpression,
        };
      }
    } else if (rawSource === "library") {
      // Source explicitement "library"
      if (typeof widget.slug === "string") {
        const slug = widget.slug.trim();
        if (slug) {
          const variables = sanitizeWidgetVariables(widget.variables);
          return { kind: "widget", source: "library", slug, variables };
        }
      }
      // Même sans slug, retourner library si c'est explicitement demandé
      return { kind: "widget", source: "library", slug: "", variables: {} };
    }

    // Fallback pour compatibilité avec ancien format (pas de source explicite)
    if (!widget.slug && definitionExpression) {
      return {
        kind: "widget",
        source: "variable",
        definitionExpression,
      };
    }

    if (typeof widget.slug === "string") {
      const slug = widget.slug.trim();
      if (slug) {
        const variables = sanitizeWidgetVariables(widget.variables);
        return { kind: "widget", source: "library", slug, variables };
      }
    }
  }

  const responseFormat = parameters.response_format;
  if (!isPlainRecord(responseFormat)) {
    return { kind: "text" };
  }
  const type = responseFormat.type;
  if (type !== "json_schema") {
    return { kind: "text" };
  }
  let name = DEFAULT_SCHEMA_NAME;
  let schema: unknown = {};

  const legacyJsonSchema = responseFormat.json_schema;
  if (isPlainRecord(legacyJsonSchema)) {
    if (typeof legacyJsonSchema.name === "string") {
      name = legacyJsonSchema.name;
    }
    if ("schema" in legacyJsonSchema) {
      schema = (legacyJsonSchema as Record<string, unknown>).schema;
    }
  }

  if (typeof responseFormat.name === "string" && responseFormat.name.trim()) {
    name = responseFormat.name;
  }
  if ("schema" in responseFormat) {
    schema = (responseFormat as Record<string, unknown>).schema;
  }

  return { kind: "json_schema", name, schema };
};

const setAgentResponseFormat = (
  parameters: AgentParameters,
  format: AgentResponseFormat,
): AgentParameters => {
  if (format.kind === "text") {
    const next = { ...(parameters as Record<string, unknown>) };
    delete next.response_format;
    delete next.response_widget;
    return stripEmpty(next);
  }

  if (format.kind === "json_schema") {
    const next = { ...(parameters as Record<string, unknown>) };
    delete next.response_widget;
    next.response_format = buildJsonSchemaFormat(format.name, format.schema);
    return next as AgentParameters;
  }

  if (format.source === "variable") {
    return setAgentResponseWidgetDefinitionExpression(parameters, format.definitionExpression);
  }

  return setAgentResponseWidgetLibrary(parameters, format.slug, format.variables);
};

export const setAgentResponseFormatKind = (
  parameters: AgentParameters,
  kind: "text" | "json_schema" | "widget",
): AgentParameters => {
  if (kind === "text") {
    return setAgentResponseFormat(parameters, { kind: "text" });
  }
  const current = getAgentResponseFormat(parameters);
  if (kind === "widget") {
    if (current.kind === "widget") {
      return setAgentResponseFormat(parameters, current);
    }
    return setAgentResponseFormat(parameters, {
      kind: "widget",
      source: "library",
      slug: "",
      variables: {},
    });
  }
  const name = current.kind === "json_schema" ? current.name : DEFAULT_SCHEMA_NAME;
  const schema = current.kind === "json_schema" ? current.schema : DEFAULT_JSON_SCHEMA;
  return setAgentResponseFormat(parameters, { kind: "json_schema", name, schema });
};

export const setAgentResponseFormatName = (
  parameters: AgentParameters,
  name: string,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  const schema = current.kind === "json_schema" ? current.schema : DEFAULT_JSON_SCHEMA;
  return setAgentResponseFormat(parameters, { kind: "json_schema", name, schema });
};

export const setAgentResponseFormatSchema = (
  parameters: AgentParameters,
  schema: unknown,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  const name = current.kind === "json_schema" ? current.name : DEFAULT_SCHEMA_NAME;
  return setAgentResponseFormat(parameters, { kind: "json_schema", name, schema });
};

const setAgentResponseWidgetLibrary = (
  parameters: AgentParameters,
  slug: string,
  variables: Record<string, string>,
): AgentParameters => {
  const trimmedSlug = slug.trim();
  const normalizedVariables = sanitizeWidgetVariables(variables);
  const next = { ...(parameters as Record<string, unknown>) };
  delete next.response_format;

  const widgetConfig: Record<string, unknown> = {
    source: "library",
    slug: trimmedSlug,
  };
  if (Object.keys(normalizedVariables).length > 0) {
    widgetConfig.variables = normalizedVariables;
  }
  next.response_widget = widgetConfig;
  return next as AgentParameters;
};

export const setAgentResponseWidgetSlug = (
  parameters: AgentParameters,
  slug: string,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  if (current.kind !== "widget" || current.source !== "library") {
    return setAgentResponseWidgetLibrary(parameters, slug, {});
  }
  return setAgentResponseWidgetLibrary(parameters, slug, current.variables);
};

export const setAgentResponseWidgetVariables = (
  parameters: AgentParameters,
  variables: Record<string, string>,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  if (current.kind !== "widget" || current.source !== "library") {
    return parameters;
  }
  return setAgentResponseWidgetLibrary(parameters, current.slug, variables);
};

const setAgentResponseWidgetDefinitionExpression = (
  parameters: AgentParameters,
  expression: string,
): AgentParameters => {
  const trimmedExpression = expression.trim();
  const next = { ...(parameters as Record<string, unknown>) };
  delete next.response_format;

  if (trimmedExpression) {
    next.response_widget = {
      source: "variable",
      definition_expression: trimmedExpression,
    };
  } else {
    delete next.response_widget;
  }

  return stripEmpty(next) as AgentParameters;
};

export const setAgentResponseWidgetSource = (
  parameters: AgentParameters,
  source: WidgetSource,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  if (current.kind === "widget" && current.source === source) {
    return parameters;
  }
  if (source === "variable") {
    const expression =
      current.kind === "widget" && current.source === "variable"
        ? current.definitionExpression
        : "";
    return setAgentResponseWidgetDefinitionExpression(parameters, expression);
  }
  const slug =
    current.kind === "widget" && current.source === "library" ? current.slug : "";
  const variables =
    current.kind === "widget" && current.source === "library" ? current.variables : {};
  return setAgentResponseWidgetLibrary(parameters, slug, variables);
};

export const setAgentResponseWidgetDefinition = (
  parameters: AgentParameters,
  expression: string,
): AgentParameters => setAgentResponseWidgetDefinitionExpression(parameters, expression);

export type WidgetVariableAssignment = {
  identifier: string;
  expression: string;
};

const sanitizeWidgetAssignments = (
  assignments: WidgetVariableAssignment[],
): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const assignment of assignments) {
    const key = assignment.identifier.trim();
    const value = assignment.expression.trim();
    if (key && value) {
      normalized[key] = value;
    }
  }
  return normalized;
};

export type WidgetNodeConfig = {
  source: WidgetSource;
  slug: string;
  definitionExpression: string;
  variables: WidgetVariableAssignment[];
  awaitAction: boolean;
};

const DEFAULT_WIDGET_NODE_AWAIT_ACTION = true;

export const getWidgetNodeConfig = (
  parameters: AgentParameters | null | undefined,
): WidgetNodeConfig => {
  const baseConfig: WidgetNodeConfig = {
    source: "library",
    slug: "",
    definitionExpression: "",
    variables: [],
    awaitAction: DEFAULT_WIDGET_NODE_AWAIT_ACTION,
  };

  if (!parameters) {
    return baseConfig;
  }
  const paramsRecord = parameters as Record<string, unknown>;
  const rawSourceOverride = paramsRecord.widget_source;
  const normalizedSourceOverride =
    typeof rawSourceOverride === "string" ? rawSourceOverride.trim().toLowerCase() : "";
  const rawWidget = paramsRecord.widget;
  if (typeof rawWidget === "string") {
    return { ...baseConfig, slug: rawWidget.trim() };
  }
  if (!isPlainRecord(rawWidget)) {
    if (normalizedSourceOverride === "variable") {
      return {
        source: "variable",
        slug: "",
        definitionExpression: "",
        variables: [],
        awaitAction: baseConfig.awaitAction,
      };
    }
    return baseConfig;
  }
  const rawSource = typeof rawWidget.source === "string" ? rawWidget.source.trim().toLowerCase() : "";
  const definitionExpressionRaw = rawWidget.definition_expression;
  const definitionExpression =
    typeof definitionExpressionRaw === "string" ? definitionExpressionRaw.trim() : "";
  const variablesRaw = rawWidget.variables;
  const variables: WidgetVariableAssignment[] = [];
  if (isPlainRecord(variablesRaw)) {
    for (const [identifier, expression] of Object.entries(variablesRaw)) {
      if (typeof identifier === "string" && typeof expression === "string") {
        variables.push({ identifier, expression });
      }
    }
  }
  const rawAwaitAction =
    rawWidget.await_action ??
    rawWidget.wait_for_action ??
    rawWidget.awaitAction ??
    rawWidget.waitForAction;
  const awaitAction =
    rawAwaitAction === undefined
      ? DEFAULT_WIDGET_NODE_AWAIT_ACTION
      : coerceBoolean(rawAwaitAction);
  if (rawSource === "variable" || (!rawWidget.slug && definitionExpression)) {
    return {
      source: "variable",
      slug: "",
      definitionExpression,
      variables: [],
      awaitAction,
    };
  }
  const slugValue = rawWidget.slug;
  const slug = typeof slugValue === "string" ? slugValue.trim() : "";
  return {
    source: "library",
    slug,
    definitionExpression: "",
    variables,
    awaitAction,
  };
};

const mergeWidgetParameters = (
  parameters: AgentParameters,
  config: WidgetNodeConfig,
): AgentParameters => {
  const awaitAction = config.awaitAction ?? DEFAULT_WIDGET_NODE_AWAIT_ACTION;
  const next = { ...(parameters as Record<string, unknown>) };
  const widgetConfig: Record<string, unknown> = { source: config.source };

  if (config.source === "variable") {
    const trimmedExpression = config.definitionExpression.trim();
    if (trimmedExpression) {
      widgetConfig.definition_expression = trimmedExpression;
    }
    if (!trimmedExpression && awaitAction === DEFAULT_WIDGET_NODE_AWAIT_ACTION) {
      delete next.widget;
      return stripEmpty(next);
    }
  } else {
    const trimmedSlug = config.slug.trim();
    const normalizedAssignments = sanitizeWidgetAssignments(config.variables);
    const hasAssignments = Object.keys(normalizedAssignments).length > 0;

    if (!trimmedSlug && !hasAssignments && awaitAction === DEFAULT_WIDGET_NODE_AWAIT_ACTION) {
      delete next.widget;
      return stripEmpty(next);
    }

    widgetConfig.slug = trimmedSlug;
    if (hasAssignments) {
      widgetConfig.variables = normalizedAssignments;
    }
  }
  if (awaitAction !== DEFAULT_WIDGET_NODE_AWAIT_ACTION) {
    widgetConfig.await_action = awaitAction;
  }
  next.widget = widgetConfig;
  return next as AgentParameters;
};

const applyWidgetSourceOverride = (
  parameters: AgentParameters,
  source: WidgetSource,
  definitionExpression: string,
): AgentParameters => {
  const next = { ...(parameters as Record<string, unknown>) };
  if (source === "variable" && !definitionExpression.trim()) {
    next.widget_source = "variable";
  } else {
    delete next.widget_source;
  }
  return stripEmpty(next);
};

export const createWidgetNodeParameters = (
  options: {
    slug?: string;
    definitionExpression?: string;
    source?: WidgetSource;
    variables?: WidgetVariableAssignment[];
    awaitAction?: boolean;
  } = {},
): AgentParameters => {
  const slug = options.slug ?? "";
  const definitionExpression = options.definitionExpression ?? "";
  const source = options.source ?? "library";
  const assignments = options.variables ?? [];
  const awaitAction =
    options.awaitAction === undefined
      ? DEFAULT_WIDGET_NODE_AWAIT_ACTION
      : !!options.awaitAction;
  const merged = mergeWidgetParameters({}, {
    source,
    slug,
    definitionExpression,
    variables: assignments,
    awaitAction,
  });
  return applyWidgetSourceOverride(merged, source, definitionExpression);
};

export const setWidgetNodeSlug = (
  parameters: AgentParameters,
  slug: string,
): AgentParameters => {
  const current = getWidgetNodeConfig(parameters);
  if (current.source === "library" && current.slug === slug) {
    return parameters;
  }
  const merged = mergeWidgetParameters(parameters, {
    source: "library",
    slug,
    definitionExpression: "",
    variables: current.source === "library" ? current.variables : [],
    awaitAction: current.awaitAction,
  });
  return applyWidgetSourceOverride(merged, "library", "");
};

export const setWidgetNodeVariables = (
  parameters: AgentParameters,
  assignments: WidgetVariableAssignment[],
): AgentParameters => {
  const current = getWidgetNodeConfig(parameters);
  if (current.source !== "library") {
    return parameters;
  }
  const merged = mergeWidgetParameters(parameters, {
    source: "library",
    slug: current.slug,
    definitionExpression: "",
    variables: assignments,
    awaitAction: current.awaitAction,
  });
  return applyWidgetSourceOverride(merged, "library", "");
};

export const resolveWidgetNodeParameters = (
  parameters: AgentParameters | null | undefined,
): AgentParameters => {
  const current = getWidgetNodeConfig(parameters ?? {});
  const merged = mergeWidgetParameters(parameters ?? {}, current);
  return applyWidgetSourceOverride(merged, current.source, current.definitionExpression);
};

export const setWidgetNodeAwaitAction = (
  parameters: AgentParameters,
  awaitAction: boolean,
): AgentParameters => {
  const current = getWidgetNodeConfig(parameters);
  if (current.awaitAction === awaitAction) {
    return parameters;
  }
  const merged = mergeWidgetParameters(parameters, {
    source: current.source,
    slug: current.slug,
    definitionExpression: current.definitionExpression,
    variables: current.variables,
    awaitAction,
  });
  return applyWidgetSourceOverride(
    merged,
    current.source,
    current.definitionExpression,
  );
};

export const setWidgetNodeSource = (
  parameters: AgentParameters,
  source: WidgetSource,
): AgentParameters => {
  const current = getWidgetNodeConfig(parameters);
  if (current.source === source) {
    return parameters;
  }
  if (source === "variable") {
    const nextDefinition =
      current.source === "variable" ? current.definitionExpression : "";
    const merged = mergeWidgetParameters(parameters, {
      source: "variable",
      slug: "",
      definitionExpression: nextDefinition,
      variables: [],
      awaitAction: current.awaitAction,
    });
    return applyWidgetSourceOverride(merged, "variable", nextDefinition);
  }
  const merged = mergeWidgetParameters(parameters, {
    source: "library",
    slug: current.source === "library" ? current.slug : "",
    definitionExpression: "",
    variables: current.source === "library" ? current.variables : [],
    awaitAction: current.awaitAction,
  });
  return applyWidgetSourceOverride(merged, "library", "");
};

export const setWidgetNodeDefinitionExpression = (
  parameters: AgentParameters,
  expression: string,
): AgentParameters => {
  const current = getWidgetNodeConfig(parameters);
  const merged = mergeWidgetParameters(parameters, {
    source: "variable",
    slug: "",
    definitionExpression: expression,
    variables: [],
    awaitAction: current.awaitAction,
  });
  return applyWidgetSourceOverride(merged, "variable", expression);
};

export type StateAssignment = {
  target: string;
  expression: string;
};

export type StateAssignmentScope = "globals" | "state";

const isStateAssignment = (value: unknown): value is StateAssignment =>
  isPlainRecord(value) && typeof value.target === "string" && typeof value.expression === "string";

export const getStateAssignments = (
  parameters: AgentParameters | null | undefined,
  scope: StateAssignmentScope,
): StateAssignment[] => {
  if (!parameters) {
    return [];
  }
  const raw = (parameters as Record<string, unknown>)[scope];
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: StateAssignment[] = [];
  for (const entry of raw) {
    if (!isStateAssignment(entry)) {
      continue;
    }
    result.push({ target: entry.target, expression: entry.expression });
  }
  return result;
};

export const setStateAssignments = (
  parameters: AgentParameters,
  scope: StateAssignmentScope,
  assignments: StateAssignment[],
): AgentParameters => {
  const sanitized = assignments
    .map((assignment) => ({
      target: assignment.target.trim(),
      expression: assignment.expression.trim(),
    }));

  const next = { ...parameters } as AgentParameters;

  if (sanitized.length === 0) {
    if (scope in next) {
      delete (next as Record<string, unknown>)[scope];
    }
    return stripEmpty(next as Record<string, unknown>);
  }

  (next as Record<string, unknown>)[scope] = sanitized.map((assignment) => ({
    target: assignment.target,
    expression: assignment.expression,
  }));

  return next;
};

export type WebSearchConfig = {
  search_context_size?: string;
  user_location?: {
    city?: string;
    region?: string;
    country?: string;
    type?: string;
  };
};

export type FileSearchConfig = {
  vector_store_slug: string;
};

export type AgentVectorStoreIngestionConfig = {
  vector_store_slug: string;
  doc_id_expression: string;
  document_expression: string;
  metadata_expression: string;
  workflow_blueprint_expression: string;
};

export type VectorStoreNodeConfig = {
  vector_store_slug: string;
  doc_id_expression: string;
  document_expression: string;
  metadata_expression: string;
  workflow_blueprint_expression: string;
};

export const getAgentVectorStoreIngestion = (
  parameters: AgentParameters | null | undefined,
): AgentVectorStoreIngestionConfig | null => {
  if (!parameters) {
    return null;
  }
  const raw = (parameters as Record<string, unknown>).vector_store_ingestion;
  if (!isPlainRecord(raw)) {
    return null;
  }

  const slug = typeof raw.vector_store_slug === "string" ? raw.vector_store_slug.trim() : "";
  const docIdCandidate = raw.doc_id_expression ?? raw.doc_id;
  const docIdExpression = typeof docIdCandidate === "string" ? docIdCandidate.trim() : "";
  const documentCandidate = raw.document_expression ?? raw.document;
  const documentExpression =
    typeof documentCandidate === "string" ? documentCandidate.trim() : "";
  const metadataExpression =
    typeof raw.metadata_expression === "string" ? raw.metadata_expression.trim() : "";
  const workflowBlueprintExpression =
    typeof raw.workflow_blueprint_expression === "string"
      ? raw.workflow_blueprint_expression.trim()
      : "";

  if (
    !slug &&
    !docIdExpression &&
    !documentExpression &&
    !metadataExpression &&
    !workflowBlueprintExpression
  ) {
    return null;
  }

  return {
    vector_store_slug: slug,
    doc_id_expression: docIdExpression,
    document_expression: documentExpression,
    metadata_expression: metadataExpression,
    workflow_blueprint_expression: workflowBlueprintExpression,
  };
};

export const setAgentVectorStoreIngestion = (
  parameters: AgentParameters,
  config: AgentVectorStoreIngestionConfig | null,
): AgentParameters => {
  const next = { ...(parameters as Record<string, unknown>) };
  if (!config) {
    delete next.vector_store_ingestion;
    return next as AgentParameters;
  }

  const slug = config.vector_store_slug.trim();
  const docId = config.doc_id_expression.trim();
  const document = config.document_expression.trim();
  const metadata = config.metadata_expression.trim();
  const workflowBlueprint = config.workflow_blueprint_expression.trim();

  if (!slug && !docId && !document && !metadata && !workflowBlueprint) {
    delete next.vector_store_ingestion;
    return next as AgentParameters;
  }

  const payload: Record<string, string> = {
    vector_store_slug: slug,
    doc_id_expression: docId,
    document_expression: document,
  };
  if (metadata) {
    payload.metadata_expression = metadata;
  }
  if (workflowBlueprint) {
    payload.workflow_blueprint_expression = workflowBlueprint;
  }
  next.vector_store_ingestion = payload;
  return next as AgentParameters;
};

const sanitizeVectorStoreNodeValue = (value: string | undefined): string =>
  value?.trim() ?? "";

export const getVectorStoreNodeConfig = (
  parameters: AgentParameters | null | undefined,
): VectorStoreNodeConfig => {
  if (!parameters) {
    return {
      vector_store_slug: "",
      doc_id_expression: "",
      document_expression: "",
      metadata_expression: "",
      workflow_blueprint_expression: "",
    };
  }

  const raw = parameters as Record<string, unknown>;
  const slug = sanitizeVectorStoreNodeValue(
    typeof raw.vector_store_slug === "string" ? raw.vector_store_slug : undefined,
  );
  const docIdCandidate =
    typeof raw.doc_id_expression === "string"
      ? raw.doc_id_expression
      : typeof raw.doc_id === "string"
        ? raw.doc_id
        : undefined;
  const documentCandidate =
    typeof raw.document_expression === "string"
      ? raw.document_expression
      : typeof raw.document === "string"
        ? raw.document
        : undefined;
  const metadata =
    typeof raw.metadata_expression === "string"
      ? raw.metadata_expression
      : undefined;
  const workflowBlueprint =
    typeof raw.workflow_blueprint_expression === "string"
      ? raw.workflow_blueprint_expression
      : undefined;

  return {
    vector_store_slug: sanitizeVectorStoreNodeValue(slug),
    doc_id_expression: sanitizeVectorStoreNodeValue(docIdCandidate),
    document_expression: sanitizeVectorStoreNodeValue(documentCandidate),
    metadata_expression: sanitizeVectorStoreNodeValue(metadata),
    workflow_blueprint_expression:
      sanitizeVectorStoreNodeValue(workflowBlueprint),
  };
};

export const setVectorStoreNodeConfig = (
  parameters: AgentParameters,
  updates: Partial<VectorStoreNodeConfig>,
): AgentParameters => {
  const current = getVectorStoreNodeConfig(parameters);
  const next: VectorStoreNodeConfig = {
    vector_store_slug: sanitizeVectorStoreNodeValue(
      updates.vector_store_slug ?? current.vector_store_slug,
    ),
    doc_id_expression: sanitizeVectorStoreNodeValue(
      updates.doc_id_expression ?? current.doc_id_expression,
    ),
    document_expression: sanitizeVectorStoreNodeValue(
      updates.document_expression ?? current.document_expression,
    ),
    metadata_expression: sanitizeVectorStoreNodeValue(
      updates.metadata_expression ?? current.metadata_expression,
    ),
    workflow_blueprint_expression: sanitizeVectorStoreNodeValue(
      updates.workflow_blueprint_expression ??
        current.workflow_blueprint_expression,
    ),
  };

  const payload: Record<string, string> = {
    vector_store_slug: next.vector_store_slug,
    doc_id_expression: next.doc_id_expression,
    document_expression: next.document_expression,
  };

  if (next.metadata_expression) {
    payload.metadata_expression = next.metadata_expression;
  }
  if (next.workflow_blueprint_expression) {
    payload.workflow_blueprint_expression = next.workflow_blueprint_expression;
  }

  return payload as AgentParameters;
};

export const createVectorStoreNodeParameters = (
  overrides: Partial<VectorStoreNodeConfig> = {},
): AgentParameters =>
  setVectorStoreNodeConfig(
    {},
    {
      vector_store_slug: overrides.vector_store_slug ?? "",
      doc_id_expression:
        overrides.doc_id_expression ?? "input.output_parsed.doc_id",
      document_expression:
        overrides.document_expression ?? "input.output_parsed",
      metadata_expression: overrides.metadata_expression ?? "",
      workflow_blueprint_expression:
        overrides.workflow_blueprint_expression ?? "",
    },
  );

const isWebSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "web_search";

const isFileSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "file_search";

const isComputerUseTool = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) {
    return false;
  }
  const rawType = value.type;
  if (typeof rawType !== "string") {
    return false;
  }
  const normalized = rawType.trim().toLowerCase();
  return normalized === "computer_use" || normalized === "computer_use_preview";
};

const DEFAULT_COMPUTER_USE_WIDTH = 1024;
const DEFAULT_COMPUTER_USE_HEIGHT = 768;
const SUPPORTED_COMPUTER_ENVIRONMENTS = new Set([
  "browser",
  "mac",
  "windows",
  "ubuntu",
]);

const sanitizeComputerDimension = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.min(Math.max(rounded, 1), 4096);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      const parsed = Number.parseFloat(trimmed);
      if (Number.isFinite(parsed)) {
        const rounded = Math.round(parsed);
        if (rounded > 0) {
          return Math.min(rounded, 4096);
        }
      }
    }
  }
  return fallback;
};

const sanitizeComputerEnvironment = (value: unknown): string => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized && SUPPORTED_COMPUTER_ENVIRONMENTS.has(normalized)) {
      return normalized;
    }
  }
  return "browser";
};

const sanitizeComputerUseConfig = (
  config: ComputerUseConfig | null | undefined,
): ComputerUseConfig | null => {
  if (!config) {
    return null;
  }

  const width = sanitizeComputerDimension(
    config.display_width,
    DEFAULT_COMPUTER_USE_WIDTH,
  );
  const height = sanitizeComputerDimension(
    config.display_height,
    DEFAULT_COMPUTER_USE_HEIGHT,
  );
  const environment = sanitizeComputerEnvironment(config.environment);

  const payload: ComputerUseConfig = {
    display_width: width,
    display_height: height,
    environment,
  };

  if (typeof config.start_url === "string" && config.start_url.trim()) {
    payload.start_url = config.start_url.trim();
  }

  return payload;
};

const WEATHER_FUNCTION_TOOL_NAME = "fetch_weather";

const WEATHER_FUNCTION_TOOL_DESCRIPTION =
  "Interroge le service météo Python et renvoie les conditions actuelles.";

const WIDGET_VALIDATION_FUNCTION_TOOL_NAME = "validate_widget";

const WIDGET_VALIDATION_FUNCTION_TOOL_DESCRIPTION =
  "Valide une définition de widget ChatKit et retourne la version normalisée.";

const WORKFLOW_VALIDATION_FUNCTION_TOOL_NAME = "validate_workflow_graph";

const WORKFLOW_VALIDATION_FUNCTION_TOOL_DESCRIPTION =
  "Valide un graphe de workflow ChatKit et retourne la version normalisée.";

const isFunctionTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && typeof value.type === "string" && value.type.trim().toLowerCase() === "function";

const getFunctionToolPayload = (
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const payload = entry.function ?? entry.payload ?? entry.parameters;
  if (isPlainRecord(payload)) {
    return payload;
  }
  return undefined;
};

const isWeatherFunctionTool = (value: unknown): boolean => {
  if (!isFunctionTool(value)) {
    return false;
  }
  const payload = getFunctionToolPayload(value);
  if (!payload) {
    return false;
  }
  const nameCandidate = payload.name ?? payload.id ?? payload.function_name;
  if (typeof nameCandidate !== "string") {
    return false;
  }
  return nameCandidate.trim().toLowerCase() === WEATHER_FUNCTION_TOOL_NAME;
};

const buildWeatherFunctionToolEntry = (): Record<string, unknown> => ({
  type: "function",
  function: {
    name: WEATHER_FUNCTION_TOOL_NAME,
    description: WEATHER_FUNCTION_TOOL_DESCRIPTION,
  },
});

const isWidgetValidationFunctionTool = (value: unknown): boolean => {
  if (!isFunctionTool(value)) {
    return false;
  }
  const payload = getFunctionToolPayload(value);
  if (!payload) {
    return false;
  }
  const nameCandidate = payload.name ?? payload.id ?? payload.function_name;
  if (typeof nameCandidate !== "string") {
    return false;
  }
  return nameCandidate.trim().toLowerCase() === WIDGET_VALIDATION_FUNCTION_TOOL_NAME;
};

const buildWidgetValidationFunctionToolEntry = (): Record<string, unknown> => ({
  type: "function",
  function: {
    name: WIDGET_VALIDATION_FUNCTION_TOOL_NAME,
    description: WIDGET_VALIDATION_FUNCTION_TOOL_DESCRIPTION,
  },
});

const isWorkflowValidationFunctionTool = (value: unknown): boolean => {
  if (!isFunctionTool(value)) {
    return false;
  }
  const payload = getFunctionToolPayload(value);
  if (!payload) {
    return false;
  }
  const nameCandidate = payload.name ?? payload.id ?? payload.function_name;
  if (typeof nameCandidate !== "string") {
    return false;
  }
  return (
    nameCandidate.trim().toLowerCase() === WORKFLOW_VALIDATION_FUNCTION_TOOL_NAME
  );
};

const buildWorkflowValidationFunctionToolEntry = (): Record<string, unknown> => ({
  type: "function",
  function: {
    name: WORKFLOW_VALIDATION_FUNCTION_TOOL_NAME,
    description: WORKFLOW_VALIDATION_FUNCTION_TOOL_DESCRIPTION,
  },
});

const WORKFLOW_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeWorkflowToolNameCandidate = (
  candidate: string | undefined,
): string | undefined => {
  if (!candidate) {
    return undefined;
  }

  if (WORKFLOW_TOOL_NAME_PATTERN.test(candidate)) {
    return candidate;
  }

  const normalized = candidate.normalize("NFKD");
  const withoutMarks = normalized.replace(/[\u0300-\u036f]/g, "");
  const replaced = withoutMarks.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const collapsed = replaced.replace(/_+/g, "_").replace(/^_+|_+$/g, "");

  if (collapsed && WORKFLOW_TOOL_NAME_PATTERN.test(collapsed)) {
    return collapsed;
  }

  return undefined;
};

const normalizeMultilineInput = (value: string): string => value.replace(/\r\n/g, "\n");

const parseKeyValueText = (
  text: string,
): { map: Record<string, string> | null; invalidLineCount: number } => {
  if (!text) {
    return { map: null, invalidLineCount: 0 };
  }

  const normalized = normalizeMultilineInput(text);
  const result: Record<string, string> = {};
  let invalidLineCount = 0;

  normalized.split("\n").forEach((line) => {
    if (!line.trim()) {
      return;
    }

    const colonIndex = line.indexOf(":");
    const equalIndex = line.indexOf("=");
    const separatorIndex = colonIndex >= 0 ? colonIndex : equalIndex;

    if (separatorIndex < 0) {
      invalidLineCount += 1;
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      invalidLineCount += 1;
      return;
    }

    result[key] = value;
  });

  return {
    map: Object.keys(result).length > 0 ? result : null,
    invalidLineCount,
  };
};

const stringifyKeyValueRecord = (value: unknown): string => {
  if (!isPlainRecord(value)) {
    return "";
  }

  const lines: string[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string") {
      continue;
    }
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
      continue;
    }
    lines.push(`${key}: ${String(raw)}`);
  }

  return lines.join("\n");
};

const parseAllowedToolsText = (
  text: string,
): {
  value: string[] | Record<string, unknown> | null;
  error: boolean;
} => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, error: false };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((entry) =>
            typeof entry === "string" ? entry.trim() : String(entry).trim(),
          )
          .filter((entry) => entry.length > 0);
        return {
          value: normalized.length > 0 ? normalized : null,
          error: false,
        };
      }
      if (parsed && typeof parsed === "object") {
        return {
          value: parsed as Record<string, unknown>,
          error: false,
        };
      }
      return { value: null, error: true };
    } catch {
      return { value: null, error: true };
    }
  }

  const entries = trimmed
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    return { value: null, error: false };
  }

  return { value: entries, error: false };
};

const parseRequireApprovalCustom = (
  text: string,
): { value: unknown | null; error: boolean } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, error: false };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed === "always" ||
      parsed === "never" ||
      (parsed && typeof parsed === "object")
    ) {
      return { value: parsed, error: false };
    }
    return { value: null, error: true };
  } catch {
    return { value: null, error: true };
  }
};

const parseArgsText = (text: string): string[] | null => {
  if (!text) {
    return null;
  }
  const normalized = normalizeMultilineInput(text);
  const values = normalized
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : null;
};

const normalizeMcpTransport = (value: unknown): AgentMcpTransport | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) {
    return null;
  }
  if (["host", "hosted", "remote", "openai"].includes(normalized)) {
    return "hosted";
  }
  if (["http", "streamable_http", "streamablehttp", "streamable"].includes(normalized)) {
    return "http";
  }
  if (["sse", "event_stream", "server_sent_events"].includes(normalized)) {
    return "sse";
  }
  if (["stdio", "std_io", "process"].includes(normalized)) {
    return "stdio";
  }
  return null;
};

const resolveMcpTransport = (
  config: Record<string, unknown>,
): AgentMcpTransport => {
  for (const key of ["kind", "mode", "transport", "server_type"]) {
    const value = normalizeMcpTransport(config[key]);
    if (value) {
      return value;
    }
  }

  const command = toOptionalString(config.command);
  if (command) {
    return "stdio";
  }

  const url = toOptionalString(config.url);
  if (url) {
    const transport = normalizeMcpTransport("http");
    return transport ?? "http";
  }

  const serverUrl = toOptionalString(config.server_url);
  if (serverUrl) {
    return "hosted";
  }

  return "hosted";
};

const extractMcpConfig = (entry: Record<string, unknown>): Record<string, unknown> => {
  const config: Record<string, unknown> = {};
  let nested: Record<string, unknown> | null = null;

  for (const key of ["mcp", "server", "config"]) {
    const candidate = entry[key];
    if (isPlainRecord(candidate)) {
      nested = candidate as Record<string, unknown>;
      break;
    }
  }

  if (nested) {
    Object.assign(config, nested);
  }

  for (const [key, value] of Object.entries(entry)) {
    if (config[key] === undefined) {
      config[key] = value;
    }
  }

  return config;
};

const isMcpToolEntry = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) {
    return false;
  }

  const rawType = value.type ?? value.tool ?? value.name;
  if (typeof rawType === "string" && rawType.trim().toLowerCase() === "mcp") {
    return true;
  }

  return (
    isPlainRecord(value.mcp) ||
    isPlainRecord(value.server) ||
    isPlainRecord(value.config)
  );
};

const buildMcpToolEntry = (config: AgentMcpToolConfig): Record<string, unknown> => {
  const entry: Record<string, unknown> = { type: "mcp" };
  const nested: Record<string, unknown> = {};
  entry.mcp = nested;

  nested.kind = config.transport;

  const label = config.serverLabel.trim();
  if (label) {
    nested.server_label = label;
  }

  const description = config.description.trim();
  if (description) {
    nested.server_description = description;
  }

  const serverUrl = config.serverUrl.trim();
  if (serverUrl) {
    nested.server_url = serverUrl;
  }

  const connectorId = config.connectorId.trim();
  if (connectorId) {
    nested.connector_id = connectorId;
  }

  const authorization = config.authorization.trim();
  if (authorization) {
    nested.authorization = authorization;
  }

  const remoteUrl = config.url.trim();
  if (remoteUrl) {
    nested.url = remoteUrl;
  }

  const command = config.command.trim();
  if (command) {
    nested.command = command;
  }

  const cwd = config.cwd.trim();
  if (cwd) {
    nested.cwd = cwd;
  }

  const normalizedHeadersText = normalizeMultilineInput(config.headersText);
  const trimmedHeaders = normalizedHeadersText.trim();
  if (trimmedHeaders) {
    nested.ui_headers_text = normalizedHeadersText;
    const headersResult = parseKeyValueText(normalizedHeadersText);
    if (headersResult.map) {
      nested.headers = headersResult.map;
    } else {
      delete nested.headers;
    }
  } else {
    delete nested.ui_headers_text;
    delete nested.headers;
  }

  const normalizedEnvText = normalizeMultilineInput(config.envText);
  const trimmedEnv = normalizedEnvText.trim();
  if (trimmedEnv) {
    nested.ui_env_text = normalizedEnvText;
    const envResult = parseKeyValueText(normalizedEnvText);
    if (envResult.map) {
      nested.env = envResult.map;
    } else {
      delete nested.env;
    }
  } else {
    delete nested.ui_env_text;
    delete nested.env;
  }

  const normalizedAllowedText = normalizeMultilineInput(config.allowedToolsText);
  const trimmedAllowed = normalizedAllowedText.trim();
  if (trimmedAllowed) {
    nested.ui_allowed_tools = normalizedAllowedText;
    const allowedResult = parseAllowedToolsText(normalizedAllowedText);
    if (!allowedResult.error && allowedResult.value !== null) {
      nested.allowed_tools = allowedResult.value;
    } else if (!allowedResult.error) {
      delete nested.allowed_tools;
    }
  } else {
    delete nested.ui_allowed_tools;
    delete nested.allowed_tools;
  }

  if (config.requireApprovalMode === "always" || config.requireApprovalMode === "never") {
    nested.require_approval = config.requireApprovalMode;
    delete nested.ui_require_approval;
  } else {
    const normalizedApproval = normalizeMultilineInput(
      config.requireApprovalCustom,
    );
    const trimmedApproval = normalizedApproval.trim();
    if (trimmedApproval) {
      nested.ui_require_approval = normalizedApproval;
      const approvalResult = parseRequireApprovalCustom(normalizedApproval);
      if (!approvalResult.error && approvalResult.value !== null) {
        nested.require_approval = approvalResult.value;
      } else if (!approvalResult.error) {
        delete nested.require_approval;
      }
    } else {
      delete nested.ui_require_approval;
      delete nested.require_approval;
    }
  }

  const args = parseArgsText(config.argsText);
  if (args) {
    nested.args = args;
  } else {
    delete nested.args;
  }

  if (config.credentialId && Number.isInteger(config.credentialId)) {
    nested.credential_id = config.credentialId;
  } else {
    delete nested.credential_id;
  }

  const credentialLabel = (config.credentialLabel ?? "").trim();
  if (credentialLabel) {
    nested.credential_label = credentialLabel;
  } else {
    delete nested.credential_label;
  }

  const credentialHint = (config.credentialHint ?? "").trim();
  if (credentialHint) {
    nested.credential_hint = credentialHint;
  } else {
    delete nested.credential_hint;
  }

  if (config.credentialAuthType) {
    nested.credential_type = config.credentialAuthType;
  } else {
    delete nested.credential_type;
  }

  nested.ui_credential_status = config.credentialStatus;

  return entry;
};

export const serializeAgentMcpToolConfig = (
  config: AgentMcpToolConfig,
): Record<string, unknown> => buildMcpToolEntry(config);

const toOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (truthyStrings.has(normalized)) {
      return true;
    }
    if (falsyStrings.has(normalized)) {
      return false;
    }
  }
  return undefined;
};

const toOptionalInteger = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
};

const extractWorkflowToolConfig = (value: unknown): WorkflowToolConfig | null => {
  if (!isPlainRecord(value)) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const typeCandidate = entry.type ?? entry.tool ?? entry.kind;
  const workflowPayload = isPlainRecord(entry.workflow)
    ? (entry.workflow as Record<string, unknown>)
    : undefined;

  const isWorkflowTool =
    (typeof typeCandidate === "string" && typeCandidate.trim().toLowerCase() === "workflow") ||
    Boolean(workflowPayload);

  if (!isWorkflowTool) {
    return null;
  }

  const slugCandidates: unknown[] = [];
  if (workflowPayload) {
    slugCandidates.push(workflowPayload.slug, workflowPayload.workflow_slug);
  }
  slugCandidates.push(entry.slug, entry.workflow_slug);

  let slug: string | undefined;
  for (const candidate of slugCandidates) {
    const sanitized = toOptionalString(candidate);
    if (sanitized) {
      slug = sanitized;
      break;
    }
  }

  if (!slug) {
    return null;
  }

  const config: WorkflowToolConfig = { slug };

  const name = toOptionalString(entry.name);
  if (name) {
    config.name = name;
  }

  const descriptionCandidates = [entry.description, workflowPayload?.description];
  for (const candidate of descriptionCandidates) {
    const description = toOptionalString(candidate);
    if (description) {
      config.description = description;
      break;
    }
  }

  const titleCandidates = [
    entry.title,
    entry.workflow_title,
    workflowPayload?.title,
    workflowPayload?.workflow_title,
  ];
  for (const candidate of titleCandidates) {
    const title = toOptionalString(candidate);
    if (title) {
      config.title = title;
      break;
    }
  }

  const identifierCandidates = [
    entry.identifier,
    entry.workflow_identifier,
    workflowPayload?.identifier,
    workflowPayload?.workflow_identifier,
  ];
  for (const candidate of identifierCandidates) {
    const identifier = toOptionalString(candidate);
    if (identifier) {
      config.identifier = identifier;
      break;
    }
  }

  const workflowIdCandidates = [
    entry.workflow_id,
    workflowPayload?.workflow_id,
    workflowPayload?.id,
    entry.id,
  ];
  for (const candidate of workflowIdCandidates) {
    const workflowId = toOptionalInteger(candidate);
    if (workflowId != null) {
      config.workflowId = workflowId;
      if (!config.identifier) {
        config.identifier = String(workflowId);
      }
      break;
    }
  }

  const showUiCandidates = [entry.show_ui, workflowPayload?.show_ui];
  for (const candidate of showUiCandidates) {
    const showUi = toOptionalBoolean(candidate);
    if (showUi !== undefined) {
      config.showUi = showUi;
      break;
    }
  }

  const initialMessageCandidates = [
    entry.initial_message,
    entry.message,
    workflowPayload?.initial_message,
    workflowPayload?.message,
  ];
  for (const candidate of initialMessageCandidates) {
    const initialMessage = toOptionalString(candidate);
    if (initialMessage) {
      config.initialMessage = initialMessage;
      break;
    }
  }

  return config;
};

const sanitizeWorkflowToolConfig = (
  config: WorkflowToolConfig | null | undefined,
): WorkflowToolConfig | null => {
  if (!config) {
    return null;
  }

  const slug = toOptionalString(config.slug);
  if (!slug) {
    return null;
  }

  const sanitized: WorkflowToolConfig = { slug };

  const workflowIdNameCandidate =
    typeof config.workflowId === "number" && Number.isInteger(config.workflowId)
      ? `workflow_${config.workflowId}`
      : undefined;

  const toolNameCandidates = [
    toOptionalString(config.name),
    toOptionalString(config.identifier),
    slug,
    workflowIdNameCandidate,
  ];

  for (const candidate of toolNameCandidates) {
    const normalized = normalizeWorkflowToolNameCandidate(candidate);
    if (normalized) {
      sanitized.name = normalized;
      break;
    }
  }

  if (!sanitized.name) {
    sanitized.name =
      normalizeWorkflowToolNameCandidate(slug) ??
      normalizeWorkflowToolNameCandidate(`workflow_${slug}`) ??
      "workflow_tool";
  }

  const description = toOptionalString(config.description);
  if (description) {
    sanitized.description = description;
  }

  const title = toOptionalString(config.title);
  if (title) {
    sanitized.title = title;
  }

  const identifier = toOptionalString(config.identifier);
  if (identifier) {
    sanitized.identifier = identifier;
  }

  const workflowId = toOptionalInteger(config.workflowId);
  if (workflowId != null) {
    sanitized.workflowId = workflowId;
  }

  if (config.showUi !== undefined) {
    sanitized.showUi = Boolean(config.showUi);
  }

  const initialMessage = toOptionalString(config.initialMessage);
  if (initialMessage) {
    sanitized.initialMessage = initialMessage;
  }

  return sanitized;
};

const buildWorkflowToolEntry = (
  config: WorkflowToolConfig,
): Record<string, unknown> => {
  const entry: Record<string, unknown> = {
    type: "workflow",
    slug: config.slug,
  };

  const workflowPayload: Record<string, unknown> = { slug: config.slug };

  if (config.name) {
    entry.name = config.name;
  }

  if (config.description) {
    entry.description = config.description;
  }

  if (config.title) {
    entry.title = config.title;
    workflowPayload.title = config.title;
    workflowPayload.workflow_title = config.title;
  }

  if (config.identifier) {
    entry.identifier = config.identifier;
    workflowPayload.identifier = config.identifier;
    workflowPayload.workflow_identifier = config.identifier;
  }

  if (config.workflowId != null) {
    entry.workflow_id = config.workflowId;
    workflowPayload.workflow_id = config.workflowId;
    workflowPayload.id = config.workflowId;
  }

  if (config.showUi !== undefined) {
    entry.show_ui = config.showUi;
    workflowPayload.show_ui = config.showUi;
  }

  if (config.initialMessage) {
    entry.initial_message = config.initialMessage;
    workflowPayload.initial_message = config.initialMessage;
  }

  entry.workflow = workflowPayload;

  return entry;
};

const sanitizeWebSearchConfig = (config: WebSearchConfig | null): WebSearchConfig | null => {
  if (!config) {
    return null;
  }

  const sanitized: WebSearchConfig = {};

  if (config.search_context_size) {
    sanitized.search_context_size = config.search_context_size;
  }

  const location = config.user_location;
  if (isPlainRecord(location)) {
    const cleanedLocation: Record<string, string> = {};
    for (const [key, value] of Object.entries(location)) {
      if (typeof value === "string" && value.trim()) {
        cleanedLocation[key] = value.trim();
      }
    }
    if (Object.keys(cleanedLocation).length > 0) {
      sanitized.user_location = cleanedLocation;
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return {};
  }

  return sanitized;
};

const sanitizeFileSearchConfig = (
  config: FileSearchConfig | null,
): Record<string, unknown> | null => {
  if (!config) {
    return null;
  }

  const slug = typeof config.vector_store_slug === "string" ? config.vector_store_slug.trim() : "";

  const sanitized: Record<string, unknown> = {
    return_documents: "full",
    vector_store_slug: slug,
  };

  if (slug) {
    sanitized.store = { slug };
  }

  return sanitized;
};

const isImageGenerationTool = (tool: unknown): Record<string, unknown> | null => {
  if (!isPlainRecord(tool)) {
    return null;
  }

  const type = tool.type ?? tool.tool ?? tool.name;
  if (typeof type !== "string" || type.trim().toLowerCase() !== "image_generation") {
    return null;
  }

  return tool;
};

const sanitizeImageGenerationConfig = (
  config: ImageGenerationToolConfig | null,
): Record<string, unknown> | null => {
  if (!config) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};

  const model = typeof config.model === "string" ? config.model.trim() : "";
  if (!model) {
    return null;
  }
  sanitized.model = model;

  const size = typeof config.size === "string" ? config.size.trim() : "";
  if (size) {
    sanitized.size = size;
  }

  const quality = typeof config.quality === "string" ? config.quality.trim() : "";
  if (quality) {
    sanitized.quality = quality;
  }

  const background = typeof config.background === "string" ? config.background.trim() : "";
  if (background) {
    sanitized.background = background;
  }

  const outputFormat =
    typeof config.output_format === "string" ? config.output_format.trim() : "";
  if (outputFormat) {
    sanitized.output_format = outputFormat;
  }

  return sanitized;
};

export const getAgentWebSearchConfig = (
  parameters: AgentParameters | null | undefined,
): WebSearchConfig | null => {
  if (!parameters) {
    return null;
  }
  const tools = parameters.tools;
  if (!Array.isArray(tools)) {
    return null;
  }
  for (const tool of tools) {
    if (!isWebSearchTool(tool)) {
      continue;
    }
    const config = tool.web_search;
    if (!isPlainRecord(config)) {
      return {};
    }
    const result: WebSearchConfig = {};
    if (typeof config.search_context_size === "string") {
      result.search_context_size = config.search_context_size;
    }
    if (isPlainRecord(config.user_location)) {
      result.user_location = { ...config.user_location } as WebSearchConfig["user_location"];
    }
    return result;
  }
  return null;
};

export const getAgentFileSearchConfig = (
  parameters: AgentParameters | null | undefined,
): FileSearchConfig | null => {
  if (!parameters) {
    return null;
  }
  const tools = parameters.tools;
  if (!Array.isArray(tools)) {
    return null;
  }
  for (const tool of tools) {
    if (!isFileSearchTool(tool)) {
      continue;
    }
    const config = tool.file_search;
    if (!isPlainRecord(config)) {
      return { vector_store_slug: "" };
    }
    const store = config.store;
    if (isPlainRecord(store) && typeof store.slug === "string") {
      return { vector_store_slug: store.slug };
    }
    const slug =
      typeof config.vector_store_slug === "string" ? config.vector_store_slug.trim() : "";
    return { vector_store_slug: slug };
  }
  return null;
};

export const getAgentWorkflowTools = (
  parameters: AgentParameters | null | undefined,
): WorkflowToolConfig[] => {
  if (!parameters) {
    return [];
  }

  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  const configs: WorkflowToolConfig[] = [];
  for (const tool of tools) {
    const config = extractWorkflowToolConfig(tool);
    if (config) {
      configs.push(config);
    }
  }

  return configs;
};

export const setAgentWorkflowTools = (
  parameters: AgentParameters,
  configs: WorkflowToolConfig[],
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const tools = Array.isArray(next.tools)
    ? ([...(next.tools as unknown[])] as unknown[])
    : [];

  const preservedTools = tools.filter((tool) => !extractWorkflowToolConfig(tool));

  const normalized = new Map<string, WorkflowToolConfig>();
  configs.forEach((config) => {
    const sanitized = sanitizeWorkflowToolConfig(config);
    if (!sanitized) {
      return;
    }
    normalized.set(sanitized.slug, sanitized);
  });

  const sanitizedConfigs = Array.from(normalized.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );

  if (sanitizedConfigs.length === 0) {
    if (preservedTools.length === 0) {
      const { tools: _ignored, ...rest } = next as Record<string, unknown>;
      return stripEmpty(rest);
    }
    return { ...next, tools: preservedTools };
  }

  const workflowEntries = sanitizedConfigs.map(buildWorkflowToolEntry);
  return { ...next, tools: [...preservedTools, ...workflowEntries] };
};

export const getAgentMcpTools = (
  parameters: AgentParameters | null | undefined,
): AgentMcpToolConfig[] => {
  if (!parameters) {
    return [];
  }

  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  const configs: AgentMcpToolConfig[] = [];
  tools.forEach((tool, index) => {
    if (!isMcpToolEntry(tool)) {
      return;
    }

    const entry = tool as Record<string, unknown>;
    const config = extractMcpConfig(entry);
    const transport = resolveMcpTransport(config);
    const serverLabel =
      toOptionalString(config.server_label) ??
      toOptionalString(config.label) ??
      toOptionalString(config.name) ??
      "";
    const serverUrl = toOptionalString(config.server_url) ?? "";
    const connectorId = toOptionalString(config.connector_id) ?? "";
    const authorization = toOptionalString(config.authorization) ?? "";
    const remoteUrl = toOptionalString(config.url) ?? "";
    const description =
      toOptionalString(config.server_description) ??
      toOptionalString(config.description) ??
      "";
    const command = toOptionalString(config.command) ?? "";
    const cwd = toOptionalString(config.cwd) ?? "";
    const argsText = Array.isArray(config.args)
      ? config.args
          .map((item) => (typeof item === "string" ? item : String(item)))
          .join("\n")
      : "";

    const headersText =
      typeof config.ui_headers_text === "string"
        ? normalizeMultilineInput(config.ui_headers_text)
        : stringifyKeyValueRecord(config.headers);

    const envText =
      typeof config.ui_env_text === "string"
        ? normalizeMultilineInput(config.ui_env_text)
        : stringifyKeyValueRecord(config.env);

    let allowedToolsText = "";
    if (typeof config.ui_allowed_tools === "string") {
      allowedToolsText = normalizeMultilineInput(config.ui_allowed_tools);
    } else if (Array.isArray(config.allowed_tools)) {
      allowedToolsText = config.allowed_tools
        .map((item) => (typeof item === "string" ? item : String(item)))
        .join("\n");
    } else if (isPlainRecord(config.allowed_tools)) {
      allowedToolsText = JSON.stringify(config.allowed_tools, null, 2);
    }

    let requireApprovalMode: AgentMcpRequireApprovalMode = "never";
    let requireApprovalCustom = "";
    const approval = config.require_approval;
    if (typeof approval === "string") {
      const normalized = approval.trim().toLowerCase();
      if (normalized === "always" || normalized === "never") {
        requireApprovalMode = normalized;
      }
    } else if (approval && typeof approval === "object") {
      requireApprovalMode = "custom";
      requireApprovalCustom = JSON.stringify(approval, null, 2);
    }

    if (typeof config.ui_require_approval === "string") {
      const normalized = normalizeMultilineInput(config.ui_require_approval);
      if (normalized.trim()) {
        requireApprovalMode = "custom";
        requireApprovalCustom = normalized;
      }
    }

    const credentialId = toOptionalInteger(config.credential_id) ?? null;
    const credentialLabel = toOptionalString(config.credential_label) ?? "";
    const credentialHint = toOptionalString(config.credential_hint) ?? "";
    const credentialType = toOptionalString(config.credential_type);
    const credentialAuthType =
      credentialType === "api_key" || credentialType === "oauth" ? credentialType : null;

    let credentialStatus: AgentMcpCredentialStatus = "disconnected";
    const statusCandidate = toOptionalString(
      config.ui_credential_status ?? config.credential_status,
    );
    if (
      statusCandidate === "connected" ||
      statusCandidate === "pending" ||
      statusCandidate === "disconnected"
    ) {
      credentialStatus = statusCandidate;
    } else if (credentialHint) {
      credentialStatus = "connected";
    }

    configs.push({
      id: `mcp-${index}`,
      transport,
      serverLabel,
      serverUrl,
      connectorId,
      authorization,
      headersText,
      allowedToolsText,
      requireApprovalMode,
      requireApprovalCustom,
      description,
      url: remoteUrl,
      command,
      argsText,
      envText,
      cwd,
      credentialId,
      credentialLabel,
      credentialHint,
      credentialStatus,
      credentialAuthType,
    });
  });

  return configs;
};

export const validateAgentMcpTools = (
  configs: AgentMcpToolConfig[],
): AgentMcpToolValidation[] =>
  configs.map((config) => {
    const errors: AgentMcpToolValidation["errors"] = {};

    if (!config.serverLabel.trim()) {
      errors.serverLabel = "missing";
    }

    if (config.transport === "hosted") {
      if (!config.serverUrl.trim() && !config.connectorId.trim()) {
        errors.connection = "missingTarget";
      }
    } else if (config.transport === "http" || config.transport === "sse") {
      if (!config.url.trim()) {
        errors.connection = "missingUrl";
      }
    } else if (config.transport === "stdio") {
      if (!config.command.trim()) {
        errors.connection = "missingCommand";
      }
    }

    const headersResult = parseKeyValueText(config.headersText);
    if (headersResult.invalidLineCount > 0) {
      errors.headers = "invalid";
    }

    const envResult = parseKeyValueText(config.envText);
    if (envResult.invalidLineCount > 0) {
      errors.env = "invalid";
    }

    const allowedResult = parseAllowedToolsText(config.allowedToolsText);
    if (allowedResult.error) {
      errors.allowedTools = "invalid";
    }

    if (config.requireApprovalMode === "custom") {
      const approvalResult = parseRequireApprovalCustom(
        config.requireApprovalCustom,
      );
      if (approvalResult.error) {
        errors.requireApproval = "invalid";
      }
    }

    return { id: config.id, errors };
  });

export const setAgentMcpTools = (
  parameters: AgentParameters,
  configs: AgentMcpToolConfig[],
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const tools = Array.isArray(next.tools)
    ? ([...(next.tools as unknown[])] as unknown[])
    : [];

  const preserved = tools.filter((tool) => !isMcpToolEntry(tool));
  const entries = configs.map(buildMcpToolEntry);

  if (entries.length === 0) {
    if (preserved.length === 0) {
      const { tools: _ignored, ...rest } = next as Record<string, unknown>;
      return stripEmpty(rest);
    }
    return { ...next, tools: preserved };
  }

  return { ...next, tools: [...preserved, ...entries] };
};

export const getAgentComputerUseConfig = (
  parameters: AgentParameters | null | undefined,
): ComputerUseConfig | null => {
  if (!parameters) {
    return null;
  }
  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return null;
  }

  for (const tool of tools) {
    if (!isComputerUseTool(tool)) {
      continue;
    }

    const source = isPlainRecord(tool.computer_use)
      ? (tool.computer_use as Record<string, unknown>)
      : isPlainRecord(tool.computer_use_preview)
        ? (tool.computer_use_preview as Record<string, unknown>)
        : (tool as Record<string, unknown>);

    if (!isPlainRecord(source)) {
      continue;
    }

    const width = sanitizeComputerDimension(
      (source as Record<string, unknown>).display_width,
      DEFAULT_COMPUTER_USE_WIDTH,
    );
    const height = sanitizeComputerDimension(
      (source as Record<string, unknown>).display_height,
      DEFAULT_COMPUTER_USE_HEIGHT,
    );
    const environment = sanitizeComputerEnvironment(
      (source as Record<string, unknown>).environment,
    );

    const result: ComputerUseConfig = {
      display_width: width,
      display_height: height,
      environment,
    };

    const startUrlCandidate =
      (source as Record<string, unknown>).start_url ??
      (source as Record<string, unknown>).initial_url ??
      (source as Record<string, unknown>).url;
    if (typeof startUrlCandidate === "string" && startUrlCandidate.trim()) {
      result.start_url = startUrlCandidate.trim();
    }

    return result;
  }

  return null;
};

export const getAgentImageGenerationConfig = (
  parameters: AgentParameters | null | undefined,
): ImageGenerationToolConfig | null => {
  if (!parameters) {
    return null;
  }
  const tools = parameters.tools;
  if (!Array.isArray(tools)) {
    return null;
  }

  for (const tool of tools) {
    const entry = isImageGenerationTool(tool);
    if (!entry) {
      continue;
    }

    const source = isPlainRecord(entry.image_generation)
      ? (entry.image_generation as Record<string, unknown>)
      : entry;

    const config: Partial<ImageGenerationToolConfig> = {};
    if (typeof source.model === "string" && source.model.trim()) {
      config.model = source.model.trim();
    }
    if (typeof source.size === "string" && source.size.trim()) {
      config.size = source.size.trim();
    }
    if (typeof source.quality === "string" && source.quality.trim()) {
      config.quality = source.quality.trim();
    }
    if (typeof source.background === "string" && source.background.trim()) {
      config.background = source.background.trim();
    }
    if (typeof source.output_format === "string" && source.output_format.trim()) {
      config.output_format = source.output_format.trim();
    }

    if (config.model) {
      return config as ImageGenerationToolConfig;
    }
  }

  return null;
};

export const setAgentWebSearchConfig = (
  parameters: AgentParameters,
  config: WebSearchConfig | null,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const sanitized = sanitizeWebSearchConfig(config);
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter((tool) => !isWebSearchTool(tool))
    : [];

  if (!sanitized) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry: Record<string, unknown> = { type: "web_search" };
  if (Object.keys(sanitized).length > 0) {
    toolEntry.web_search = sanitized;
  }

  return { ...next, tools: [...tools, toolEntry] };
};

export const setAgentFileSearchConfig = (
  parameters: AgentParameters,
  config: FileSearchConfig | null,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const sanitized = sanitizeFileSearchConfig(config);
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter((tool) => !isFileSearchTool(tool))
    : [];

  if (!sanitized) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry: Record<string, unknown> = { type: "file_search", file_search: sanitized };
  return { ...next, tools: [...tools, toolEntry] };
};

export const setAgentComputerUseConfig = (
  parameters: AgentParameters,
  config: ComputerUseConfig | null,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const sanitized = sanitizeComputerUseConfig(config);
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter((tool) => !isComputerUseTool(tool))
    : [];

  if (!sanitized) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry: Record<string, unknown> = {
    type: "computer_use",
    computer_use: sanitized,
  };

  return { ...next, tools: [...tools, toolEntry] };
};

export const setAgentImageGenerationConfig = (
  parameters: AgentParameters,
  config: ImageGenerationToolConfig | null,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const sanitized = sanitizeImageGenerationConfig(config);
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter((tool) => !isImageGenerationTool(tool))
    : [];

  if (!sanitized) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry: Record<string, unknown> = {
    type: "image_generation",
    image_generation: sanitized,
  };

  return { ...next, tools: [...tools, toolEntry] };
};

export const getAgentWeatherToolEnabled = (
  parameters: AgentParameters | null | undefined,
): boolean => {
  if (!parameters) {
    return false;
  }
  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  return tools.some((tool) => isWeatherFunctionTool(tool));
};

export const setAgentWeatherToolEnabled = (
  parameters: AgentParameters,
  enabled: boolean,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter((tool) => !isWeatherFunctionTool(tool))
    : [];

  if (!enabled) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry = buildWeatherFunctionToolEntry();
  return { ...next, tools: [...tools, toolEntry] };
};

export const getAgentWidgetValidationToolEnabled = (
  parameters: AgentParameters | null | undefined,
): boolean => {
  if (!parameters) {
    return false;
  }
  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  return tools.some((tool) => isWidgetValidationFunctionTool(tool));
};

export const setAgentWidgetValidationToolEnabled = (
  parameters: AgentParameters,
  enabled: boolean,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter((tool) => !isWidgetValidationFunctionTool(tool))
    : [];

  if (!enabled) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry = buildWidgetValidationFunctionToolEntry();
  return { ...next, tools: [...tools, toolEntry] };
};

export const getAgentWorkflowValidationToolEnabled = (
  parameters: AgentParameters | null | undefined,
): boolean => {
  if (!parameters) {
    return false;
  }
  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return false;
  }
  return tools.some((tool) => isWorkflowValidationFunctionTool(tool));
};

export const setAgentWorkflowValidationToolEnabled = (
  parameters: AgentParameters,
  enabled: boolean,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const tools = Array.isArray(next.tools)
    ? (next.tools as unknown[]).filter(
        (tool) => !isWorkflowValidationFunctionTool(tool),
      )
    : [];

  if (!enabled) {
    if (tools.length === 0) {
      const { tools: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, tools };
  }

  const toolEntry = buildWorkflowValidationFunctionToolEntry();
  return { ...next, tools: [...tools, toolEntry] };
};
