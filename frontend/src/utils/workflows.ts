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

export const getVoiceName = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const voice = parameters.voice;
  return typeof voice === "string" ? voice : "";
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

export const setVoiceName = (parameters: AgentParameters, voice: string): AgentParameters => {
  const trimmed = voice.trim();
  const next = { ...parameters } as AgentParameters;
  if (!trimmed) {
    const { voice: _ignored, ...rest } = next;
    return stripEmpty(rest);
  }
  return { ...next, voice: trimmed };
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

export const setAgentReasoningVerbosity = (
  parameters: AgentParameters,
  value: string,
): AgentParameters => {
  const trimmed = value.trim();
  if (!trimmed) {
    return updateReasoningSettings(parameters, (current) => {
      const { verbosity: _ignored, ...rest } = current;
      return rest;
    });
  }
  return updateReasoningSettings(parameters, (current) => ({
    ...current,
    verbosity: trimmed,
  }));
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

export type AgentResponseFormat =
  | { kind: "text" }
  | { kind: "json_schema"; name: string; schema: unknown }
  | { kind: "widget"; slug: string; variables: Record<string, string> };

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
      return { kind: "widget", slug, variables: {} };
    }
  } else if (isPlainRecord(widget) && typeof widget.slug === "string") {
    const slug = widget.slug.trim();
    const variables = sanitizeWidgetVariables(widget.variables);
    return { kind: "widget", slug, variables };
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

  return setAgentResponseWidget(parameters, format.slug, format.variables);
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
    const slug = current.kind === "widget" ? current.slug : "";
    const variables = current.kind === "widget" ? current.variables : {};
    return setAgentResponseWidget(parameters, slug, variables);
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

const setAgentResponseWidget = (
  parameters: AgentParameters,
  slug: string,
  variables: Record<string, string>,
): AgentParameters => {
  const trimmedSlug = slug.trim();
  const normalizedVariables = sanitizeWidgetVariables(variables);
  const next = { ...(parameters as Record<string, unknown>) };
  delete next.response_format;

  if (Object.keys(normalizedVariables).length > 0) {
    next.response_widget = { slug: trimmedSlug, variables: normalizedVariables };
  } else {
    next.response_widget = { slug: trimmedSlug };
  }
  return next as AgentParameters;
};

export const setAgentResponseWidgetSlug = (
  parameters: AgentParameters,
  slug: string,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  const variables =
    current.kind === "widget" && current.slug === slug.trim() ? current.variables : {};
  return setAgentResponseWidget(parameters, slug, variables);
};

export const setAgentResponseWidgetVariables = (
  parameters: AgentParameters,
  variables: Record<string, string>,
): AgentParameters => {
  const current = getAgentResponseFormat(parameters);
  if (current.kind !== "widget") {
    return parameters;
  }
  return setAgentResponseWidget(parameters, current.slug, variables);
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
