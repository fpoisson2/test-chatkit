export type AgentParameters = Record<string, unknown>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
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
