import {
  isPlainRecord,
  type AgentParameters,
  type StateAssignment,
  type StateAssignmentScope,
} from "./workflows";

/**
 * Préconfigurations héritées des agents spécifiques afin de pré-remplir les blocs
 * génériques lors de l'import d'un workflow existant.
 */
const LEGACY_AGENT_DEFAULTS: Record<string, AgentParameters> = {
  triage: {},
  r_dacteur: {},
  get_data_from_web: {},
  triage_2: {},
  get_data_from_user: {},
};

const cloneParameters = (source: AgentParameters | null | undefined): AgentParameters => {
  if (!source || !isPlainRecord(source)) {
    return {};
  }
  return JSON.parse(JSON.stringify(source)) as AgentParameters;
};

const STATE_PRESETS: Record<
  string,
  { scope: StateAssignmentScope; assignments: readonly StateAssignment[] }
> = {};

const isStateAssignment = (value: unknown): value is StateAssignment =>
  isPlainRecord(value) && typeof value.target === "string" && typeof value.expression === "string";

const normalizeAssignments = (
  defaults: readonly StateAssignment[],
  overrides: unknown,
): StateAssignment[] => {
  const base = new Map<string, string>();
  for (const assignment of defaults) {
    base.set(assignment.target, assignment.expression);
  }

  if (Array.isArray(overrides)) {
    for (const entry of overrides) {
      if (!isStateAssignment(entry)) {
        continue;
      }
      const target = entry.target.trim();
      if (!base.has(target)) {
        continue;
      }
      base.set(target, entry.expression.trim());
    }
  }

  return defaults.map((assignment) => ({
    target: assignment.target,
    expression: base.get(assignment.target) ?? assignment.expression,
  }));
};

const mergeModelSettings = (
  defaults: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!defaults && !overrides) {
    return undefined;
  }

  const base = { ...(defaults ?? {}) } as Record<string, unknown>;

  if (!overrides) {
    return base;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "reasoning" && isPlainRecord(value)) {
      const defaultReasoning = isPlainRecord(base.reasoning)
        ? { ...(base.reasoning as Record<string, unknown>) }
        : {};
      base.reasoning = { ...defaultReasoning, ...value };
    } else if (value === null || value === undefined) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }

  if (Object.keys(base).length === 0) {
    return undefined;
  }

  return base;
};

const mergeAgentParameters = (
  defaults: AgentParameters,
  overrides: AgentParameters,
): AgentParameters => {
  const result = cloneParameters(defaults);
  if (Object.keys(overrides).length === 0) {
    return result;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "model_settings") {
      if (isPlainRecord(value) || value === null || value === undefined) {
        const merged = mergeModelSettings(
          isPlainRecord(result.model_settings)
            ? (result.model_settings as Record<string, unknown>)
            : undefined,
          isPlainRecord(value) ? (value as Record<string, unknown>) : undefined,
        );
        if (merged) {
          result.model_settings = merged;
        } else {
          delete result.model_settings;
        }
      } else {
        result.model_settings = value;
      }
      continue;
    }

    if (value === undefined) {
      continue;
    }

    if (value === null) {
      delete result[key];
      continue;
    }

    result[key] = value;
  }

  return result;
};

export const resolveAgentParameters = (
  agentKey: string | null | undefined,
  rawParameters: AgentParameters | null | undefined,
): AgentParameters => {
  const overrides = cloneParameters(rawParameters);
  if (!agentKey) {
    return overrides;
  }

  const defaults = LEGACY_AGENT_DEFAULTS[agentKey];
  if (!defaults) {
    return overrides;
  }

  return mergeAgentParameters(defaults, overrides);
};

export const resolveStateParameters = (
  slug: string,
  rawParameters: AgentParameters | null | undefined,
): AgentParameters => {
  const overrides = cloneParameters(rawParameters);
  const preset = STATE_PRESETS[slug];
  if (!preset) {
    return overrides;
  }

  const mergedAssignments = normalizeAssignments(
    preset.assignments,
    (overrides as Record<string, unknown>)[preset.scope],
  );

  (overrides as Record<string, unknown>)[preset.scope] = mergedAssignments;

  return overrides;
};
