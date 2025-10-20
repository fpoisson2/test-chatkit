export type AgentParameters = Record<string, unknown>;

export type ImageGenerationToolConfig = {
  model: string;
  size?: string;
  quality?: string;
  background?: string;
  output_format?: string;
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
  value: boolean,
): AgentParameters => setBooleanSetting(parameters, "store", value);

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
): { type: string; json_schema: { name: string; schema: unknown } } => ({
  type: "json_schema",
  json_schema: {
    name: sanitizeSchemaName(name),
    schema: schema ?? {},
  },
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
    if (rawSource === "variable" || (!widget.slug && definitionExpression)) {
      if (definitionExpression) {
        return {
          kind: "widget",
          source: "variable",
          definitionExpression,
        };
      }
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
  const jsonSchema = responseFormat.json_schema;
  if (!isPlainRecord(jsonSchema)) {
    return { kind: "json_schema", name: DEFAULT_SCHEMA_NAME, schema: {} };
  }
  const name = typeof jsonSchema.name === "string" ? jsonSchema.name : DEFAULT_SCHEMA_NAME;
  const schema = "schema" in jsonSchema ? (jsonSchema as Record<string, unknown>).schema : {};
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
};

export type VectorStoreNodeConfig = {
  vector_store_slug: string;
  doc_id_expression: string;
  document_expression: string;
  metadata_expression: string;
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

  if (!slug && !docIdExpression && !documentExpression && !metadataExpression) {
    return null;
  }

  return {
    vector_store_slug: slug,
    doc_id_expression: docIdExpression,
    document_expression: documentExpression,
    metadata_expression: metadataExpression,
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

  if (!slug && !docId && !document && !metadata) {
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

  return {
    vector_store_slug: sanitizeVectorStoreNodeValue(slug),
    doc_id_expression: sanitizeVectorStoreNodeValue(docIdCandidate),
    document_expression: sanitizeVectorStoreNodeValue(documentCandidate),
    metadata_expression: sanitizeVectorStoreNodeValue(metadata),
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
  };

  const payload: Record<string, string> = {
    vector_store_slug: next.vector_store_slug,
    doc_id_expression: next.doc_id_expression,
    document_expression: next.document_expression,
  };

  if (next.metadata_expression) {
    payload.metadata_expression = next.metadata_expression;
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
    },
  );

const isWebSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "web_search";

const isFileSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "file_search";

const WEATHER_FUNCTION_TOOL_NAME = "fetch_weather";

const WEATHER_FUNCTION_TOOL_DESCRIPTION =
  "Interroge le service météo Python et renvoie les conditions actuelles.";

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
