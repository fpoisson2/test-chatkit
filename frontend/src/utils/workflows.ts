export type AgentParameters = Record<string, unknown>;

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

export const getAgentReasoningVerbosity = (
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
  const verbosity = reasoning.verbosity;
  return typeof verbosity === "string" ? verbosity : "";
};

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
  if (typeof summary === "string") {
    return summary;
  }
  return "";
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
  return { ...next, instructions: trimmed };
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
  const next = { ...parameters } as AgentParameters;
  const existingModelSettings = isPlainRecord(next.model_settings)
    ? { ...(next.model_settings as Record<string, unknown>) }
    : undefined;

  if (!trimmed) {
    if (!existingModelSettings) {
      const { model_settings: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    const { reasoning: _reasoning, ...restSettings } = existingModelSettings;
    if (Object.keys(restSettings).length === 0) {
      const { model_settings: _ignored, ...rest } = next;
      return stripEmpty(rest);
    }
    return { ...next, model_settings: restSettings };
  }

  const reasoning = existingModelSettings?.reasoning;
  const nextReasoning = isPlainRecord(reasoning)
    ? { ...(reasoning as Record<string, unknown>), effort: trimmed }
    : { effort: trimmed };

  if (!("summary" in nextReasoning)) {
    nextReasoning.summary = "auto";
  }

  const mergedSettings: Record<string, unknown> = {
    ...(existingModelSettings ?? {}),
    reasoning: nextReasoning,
  };

  if (!("store" in mergedSettings)) {
    mergedSettings.store = true;
  }

  return { ...next, model_settings: mergedSettings };
};

export const setAgentReasoningVerbosity = (
  parameters: AgentParameters,
  verbosity: string,
): AgentParameters => {
  const trimmed = verbosity.trim();
  return updateReasoningSettings(parameters, (current) => {
    const next = { ...current } as Record<string, unknown>;
    if (!trimmed) {
      if ("verbosity" in next) {
        delete next.verbosity;
      }
      return next;
    }
    next.verbosity = trimmed;
    return next;
  });
};

export const setAgentReasoningSummary = (
  parameters: AgentParameters,
  summary: string,
): AgentParameters =>
  updateReasoningSettings(parameters, (current) => {
    const next = { ...current } as Record<string, unknown>;
    if (!summary.trim()) {
      next.summary = null;
      return next;
    }
    next.summary = summary.trim();
    return next;
  });

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

const updateReasoningSettings = (
  parameters: AgentParameters,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): AgentParameters =>
  updateModelSettings(parameters, (current) => {
    const existingReasoning = isPlainRecord(current.reasoning)
      ? { ...(current.reasoning as Record<string, unknown>) }
      : {};
    const updatedReasoning = updater(existingReasoning);
    const nextSettings = { ...current } as Record<string, unknown>;
    if (Object.keys(updatedReasoning).length === 0) {
      const { reasoning: _ignored, ...rest } = nextSettings;
      return rest;
    }
    nextSettings.reasoning = updatedReasoning;
    return nextSettings;
  });

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
  const maxTokens = modelSettings.max_output_tokens;
  return typeof maxTokens === "number" ? maxTokens : null;
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

export type AgentResponseFormat =
  | { kind: "text" }
  | { kind: "json_schema"; name: string; schema: unknown };

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

export const getAgentResponseFormat = (
  parameters: AgentParameters | null | undefined,
): AgentResponseFormat => {
  if (!parameters) {
    return { kind: "text" };
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
  const next = { ...parameters } as AgentParameters;
  if (format.kind === "text") {
    const { response_format: _ignored, ...rest } = next;
    return stripEmpty(rest);
  }
  return {
    ...next,
    response_format: buildJsonSchemaFormat(format.name, format.schema),
  };
};

export const setAgentResponseFormatKind = (
  parameters: AgentParameters,
  kind: "text" | "json_schema",
): AgentParameters => {
  if (kind === "text") {
    return setAgentResponseFormat(parameters, { kind: "text" });
  }
  const current = getAgentResponseFormat(parameters);
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

const isWebSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "web_search";

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

const getBooleanParameter = (
  parameters: AgentParameters | null | undefined,
  key: string,
): boolean | null => {
  if (!parameters) {
    return null;
  }
  const value = (parameters as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
};

const setBooleanParameter = (
  parameters: AgentParameters,
  key: string,
  value: boolean | null,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  if (value === null) {
    if (key in next) {
      const { [key]: _ignored, ...rest } = next as Record<string, unknown>;
      return stripEmpty(rest);
    }
    return stripEmpty(next);
  }
  return { ...next, [key]: value } as AgentParameters;
};

export const getAgentIncludeChatHistory = (
  parameters: AgentParameters | null | undefined,
): boolean | null => getBooleanParameter(parameters, "include_chat_history");

export const setAgentIncludeChatHistory = (
  parameters: AgentParameters,
  value: boolean | null,
): AgentParameters => setBooleanParameter(parameters, "include_chat_history", value);

export const getAgentDisplayResponseInChat = (
  parameters: AgentParameters | null | undefined,
): boolean | null => getBooleanParameter(parameters, "display_response_in_chat");

export const setAgentDisplayResponseInChat = (
  parameters: AgentParameters,
  value: boolean | null,
): AgentParameters => setBooleanParameter(parameters, "display_response_in_chat", value);

export const getAgentShowSearchSources = (
  parameters: AgentParameters | null | undefined,
): boolean | null => getBooleanParameter(parameters, "show_search_sources");

export const setAgentShowSearchSources = (
  parameters: AgentParameters,
  value: boolean | null,
): AgentParameters => setBooleanParameter(parameters, "show_search_sources", value);

export const getAgentContinueOnError = (
  parameters: AgentParameters | null | undefined,
): boolean | null => getBooleanParameter(parameters, "continue_on_error");

export const setAgentContinueOnError = (
  parameters: AgentParameters,
  value: boolean | null,
): AgentParameters => setBooleanParameter(parameters, "continue_on_error", value);

export const getAgentWriteToConversationHistory = (
  parameters: AgentParameters | null | undefined,
): boolean | null => getBooleanParameter(parameters, "write_to_conversation_history");

export const setAgentWriteToConversationHistory = (
  parameters: AgentParameters,
  value: boolean | null,
): AgentParameters => setBooleanParameter(parameters, "write_to_conversation_history", value);
