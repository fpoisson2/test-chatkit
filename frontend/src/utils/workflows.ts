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

  if (typeof nextReasoning.summary !== "string") {
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

export type FileSearchConfig = {
  vector_store_slug: string;
};

const isWebSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "web_search";

const isFileSearchTool = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && value.type === "file_search";

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
