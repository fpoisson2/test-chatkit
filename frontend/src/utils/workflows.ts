export type AgentParameters = Record<string, unknown>;

export type ParallelBranch = {
  slug: string;
  label: string;
};

export type ImageGenerationToolConfig = {
  model: string;
  size?: string;
  quality?: string;
  background?: string;
  output_format?: string;
  partial_images?: number;
};

export type ComputerUseConfig = {
  display_width: number;
  display_height: number;
  environment: string;
  start_url?: string;
  // SSH-specific configuration
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  ssh_password?: string;
  ssh_private_key?: string;
  // VNC-specific configuration
  vnc_host?: string;
  vnc_port?: number;
  vnc_password?: string;
  novnc_port?: number;
};

export type McpSseToolConfig = {
  serverId: number;
  toolNames: string[];
  authorizationOverride?: string;
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

export type EndAgsConfig = {
  variableId: string;
  valueExpression: string;
  maximumExpression: string;
  commentExpression: string;
};

const EMPTY_END_AGS_CONFIG: EndAgsConfig = {
  variableId: "",
  valueExpression: "",
  maximumExpression: "",
  commentExpression: "",
};

const normalizeEndAgsExpression = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

export const getEndAgsConfig = (
  parameters: AgentParameters | null | undefined,
): EndAgsConfig => {
  if (!parameters) {
    return EMPTY_END_AGS_CONFIG;
  }

  const ags = (parameters as Record<string, unknown>).ags;
  if (!isPlainRecord(ags)) {
    return EMPTY_END_AGS_CONFIG;
  }

  const config = ags as Record<string, unknown>;
  const variableId =
    normalizeEndAgsExpression(config["score_variable_id"]) ||
    normalizeEndAgsExpression(config["variable_id"]);

  const valueExpression =
    normalizeEndAgsExpression(config["value"]) ||
    normalizeEndAgsExpression(config["score"]) ||
    normalizeEndAgsExpression(config["score_value"]);

  const maximumExpression =
    normalizeEndAgsExpression(config["maximum"]) ||
    normalizeEndAgsExpression(config["max_score"]);

  const commentExpression =
    normalizeEndAgsExpression(config["comment"]) ||
    normalizeEndAgsExpression(config["note"]);

  return {
    variableId,
    valueExpression,
    maximumExpression,
    commentExpression,
  } satisfies EndAgsConfig;
};

const updateEndAgsParameters = (
  parameters: AgentParameters,
  mutator: (ags: Record<string, unknown>) => void,
): AgentParameters => {
  const next = { ...(parameters as Record<string, unknown>) };
  const currentAgs = isPlainRecord(next.ags)
    ? { ...(next.ags as Record<string, unknown>) }
    : {};

  mutator(currentAgs);

  if (Object.keys(currentAgs).length === 0) {
    delete next.ags;
  } else {
    next.ags = currentAgs;
  }

  return stripEmpty(next);
};

export const setEndAgsVariableId = (
  parameters: AgentParameters,
  identifier: string,
): AgentParameters =>
  updateEndAgsParameters(parameters, (ags) => {
    delete ags.variable_id;

    const trimmed = identifier.trim();
    if (!trimmed) {
      delete ags.score_variable_id;
      return;
    }

    ags.score_variable_id = trimmed;
  });

const setEndAgsExpressionField = (
  parameters: AgentParameters,
  field: "value" | "maximum" | "comment",
  value: string,
): AgentParameters =>
  updateEndAgsParameters(parameters, (ags) => {
    const trimmed = value.trim();
    if (!trimmed) {
      delete ags[field];
      if (field === "value") {
        delete ags.score;
        delete ags.score_value;
      }
      if (field === "maximum") {
        delete ags.max_score;
      }
      if (field === "comment") {
        delete ags.note;
      }
      return;
    }

    ags[field] = trimmed;
    if (field === "value") {
      delete ags.score;
      delete ags.score_value;
    }
    if (field === "maximum") {
      delete ags.max_score;
    }
    if (field === "comment") {
      delete ags.note;
    }
  });

export const setEndAgsScoreExpression = (
  parameters: AgentParameters,
  expression: string,
): AgentParameters => setEndAgsExpressionField(parameters, "value", expression);

export const setEndAgsMaximumExpression = (
  parameters: AgentParameters,
  expression: string,
): AgentParameters => setEndAgsExpressionField(parameters, "maximum", expression);

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

export const getWhileCondition = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const condition = (parameters as Record<string, unknown>).condition;
  return typeof condition === "string" ? condition : "";
};

export const getWhileMaxIterations = (parameters: AgentParameters | null | undefined): number => {
  if (!parameters) {
    return 100;
  }
  const maxIterations = (parameters as Record<string, unknown>).max_iterations;
  return typeof maxIterations === "number" ? maxIterations : 100;
};

export const getWhileIterationVar = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const iterationVar = (parameters as Record<string, unknown>).iteration_var;
  return typeof iterationVar === "string" ? iterationVar : "";
};

const generateParallelBranchSlug = (preferred: string | null | undefined, seen: Set<string>): string => {
  const base = typeof preferred === "string" ? preferred.trim() : "";
  if (base && !seen.has(base)) {
    seen.add(base);
    return base;
  }

  let index = 1;
  while (true) {
    const candidate = base ? `${base}-${index}` : `branch_${seen.size + index}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      return candidate;
    }
    index += 1;
  }
};

const ensureParallelBranches = (value: unknown): ParallelBranch[] => {
  const sanitized: ParallelBranch[] = [];
  const seen = new Set<string>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isPlainRecord(entry)) {
        continue;
      }
      const slug = generateParallelBranchSlug(entry.slug, seen);
      const label = typeof entry.label === "string" ? entry.label : "";
      sanitized.push({ slug, label });
    }
  }

  while (sanitized.length < 2) {
    const slug = generateParallelBranchSlug(null, seen);
    sanitized.push({ slug, label: "" });
  }

  return sanitized;
};

export const getParallelSplitJoinSlug = (parameters: AgentParameters | null | undefined): string => {
  if (!parameters) {
    return "";
  }
  const raw = (parameters as Record<string, unknown>).join_slug;
  return typeof raw === "string" ? raw.trim() : "";
};

export const getParallelSplitBranches = (
  parameters: AgentParameters | null | undefined,
): ParallelBranch[] => {
  if (!parameters) {
    return ensureParallelBranches(null);
  }
  const branches = (parameters as Record<string, unknown>).branches;
  return ensureParallelBranches(branches);
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

export const getStartTelephonySipAccountId = (
  parameters: AgentParameters | null | undefined,
): number | null => {
  if (!parameters) {
    return null;
  }

  const telephony = cloneStartTelephonyConfig(
    (parameters as Record<string, unknown>).telephony,
  );

  const value = telephony.sip_account_id;
  if (typeof value === "number" && value > 0) {
    return value;
  }
  return null;
};

export const setStartTelephonySipAccountId = (
  parameters: AgentParameters,
  sipAccountId: number | null,
): AgentParameters =>
  updateStartTelephonyConfig(parameters, (current) => {
    if (!sipAccountId) {
      const { sip_account_id: _ignored, ...rest } = current;
      return rest;
    }
    return { ...current, sip_account_id: sipAccountId };
  });

export const getStartTelephonyRingTimeout = (
  parameters: AgentParameters | null | undefined,
): number => {
  if (!parameters) {
    return 0;
  }

  const telephony = cloneStartTelephonyConfig(
    (parameters as Record<string, unknown>).telephony,
  );

  const value = telephony.ring_timeout_seconds;
  if (typeof value === "number" && value >= 0) {
    return value;
  }
  return 0;
};

export const setStartTelephonyRingTimeout = (
  parameters: AgentParameters,
  ringTimeout: number,
): AgentParameters =>
  updateStartTelephonyConfig(parameters, (current) => {
    if (ringTimeout <= 0) {
      const { ring_timeout_seconds: _ignored, ...rest } = current;
      return rest;
    }
    return { ...current, ring_timeout_seconds: ringTimeout };
  });

export const getStartTelephonySpeakFirst = (
  parameters: AgentParameters | null | undefined,
): boolean => {
  if (!parameters) {
    return false;
  }

  const telephony = cloneStartTelephonyConfig(
    (parameters as Record<string, unknown>).telephony,
  );

  const value = telephony.speak_first;
  return typeof value === "boolean" ? value : false;
};

export const setStartTelephonySpeakFirst = (
  parameters: AgentParameters,
  speakFirst: boolean,
): AgentParameters =>
  updateStartTelephonyConfig(parameters, (current) => {
    if (!speakFirst) {
      const { speak_first: _ignored, ...rest } = current;
      return rest;
    }
    return { ...current, speak_first: speakFirst };
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

export const setWhileCondition = (
  parameters: AgentParameters,
  condition: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = condition.trim();
  if (!trimmed) {
    delete (next as Record<string, unknown>).condition;
    return stripEmpty(next as Record<string, unknown>);
  }
  (next as Record<string, unknown>).condition = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const setWhileMaxIterations = (
  parameters: AgentParameters,
  maxIterations: number,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  (next as Record<string, unknown>).max_iterations = maxIterations;
  return stripEmpty(next as Record<string, unknown>);
};

export const setWhileIterationVar = (
  parameters: AgentParameters,
  iterationVar: string,
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const trimmed = iterationVar.trim();
  if (!trimmed) {
    delete (next as Record<string, unknown>).iteration_var;
    return stripEmpty(next as Record<string, unknown>);
  }
  (next as Record<string, unknown>).iteration_var = trimmed;
  return stripEmpty(next as Record<string, unknown>);
};

export const setParallelSplitJoinSlug = (
  parameters: AgentParameters,
  joinSlug: string,
): AgentParameters => {
  const next = { ...parameters } as Record<string, unknown>;
  const trimmed = joinSlug.trim();
  if (!trimmed) {
    delete next.join_slug;
  } else {
    next.join_slug = trimmed;
  }
  return stripEmpty(next);
};

export const setParallelSplitBranches = (
  parameters: AgentParameters,
  branches: ParallelBranch[],
): AgentParameters => {
  const normalized = ensureParallelBranches(branches.map((branch) => ({ ...branch })));
  const next = { ...parameters } as Record<string, unknown>;
  next.branches = normalized.map((branch) => ({
    slug: branch.slug,
    label: branch.label.trim(),
  }));
  return stripEmpty(next);
};

export const createParallelSplitParameters = (): AgentParameters => {
  const branches = ensureParallelBranches([]);
  return {
    join_slug: "",
    branches: branches.map((branch) => ({ slug: branch.slug, label: branch.label })),
  } satisfies AgentParameters;
};

export const createParallelJoinParameters = (): AgentParameters => ({});

export const resolveParallelSplitParameters = (
  parameters: AgentParameters | null | undefined,
): AgentParameters => {
  const joinSlug = getParallelSplitJoinSlug(parameters);
  const branches = getParallelSplitBranches(parameters);
  return {
    join_slug: joinSlug,
    branches: branches.map((branch) => ({ slug: branch.slug, label: branch.label })),
  } satisfies AgentParameters;
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
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_TRANSCRIPTION_LANGUAGE = "fr-CA";

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
    input_audio_transcription: {
      model: DEFAULT_TRANSCRIPTION_MODEL,
      language: DEFAULT_TRANSCRIPTION_LANGUAGE,
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

export const getTranscriptionModel = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return DEFAULT_TRANSCRIPTION_MODEL;
  }
  const realtime = (parameters as Record<string, unknown>).realtime;
  if (!isPlainRecord(realtime)) {
    return DEFAULT_TRANSCRIPTION_MODEL;
  }
  const transcription = realtime.input_audio_transcription;
  if (!isPlainRecord(transcription)) {
    return DEFAULT_TRANSCRIPTION_MODEL;
  }
  const model = (transcription as Record<string, unknown>).model;
  if (typeof model === "string" && model.trim()) {
    return model.trim();
  }
  return DEFAULT_TRANSCRIPTION_MODEL;
};

export const setTranscriptionModel = (
  parameters: AgentParameters,
  model: string,
): AgentParameters =>
  updateVoiceRealtimeConfig(parameters, (current) => {
    const transcription = isPlainRecord(current.input_audio_transcription)
      ? { ...(current.input_audio_transcription as Record<string, unknown>) }
      : {};
    const normalized = model.trim() || DEFAULT_TRANSCRIPTION_MODEL;
    transcription.model = normalized;
    return { ...current, input_audio_transcription: transcription };
  });

export const getTranscriptionLanguage = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return DEFAULT_TRANSCRIPTION_LANGUAGE;
  }
  const realtime = (parameters as Record<string, unknown>).realtime;
  if (!isPlainRecord(realtime)) {
    return DEFAULT_TRANSCRIPTION_LANGUAGE;
  }
  const transcription = realtime.input_audio_transcription;
  if (!isPlainRecord(transcription)) {
    return DEFAULT_TRANSCRIPTION_LANGUAGE;
  }
  const language = (transcription as Record<string, unknown>).language;
  if (typeof language === "string" && language.trim()) {
    return language.trim();
  }
  return DEFAULT_TRANSCRIPTION_LANGUAGE;
};

export const setTranscriptionLanguage = (
  parameters: AgentParameters,
  language: string,
): AgentParameters =>
  updateVoiceRealtimeConfig(parameters, (current) => {
    const transcription = isPlainRecord(current.input_audio_transcription)
      ? { ...(current.input_audio_transcription as Record<string, unknown>) }
      : {};
    const normalized = language.trim() || DEFAULT_TRANSCRIPTION_LANGUAGE;
    transcription.language = normalized;
    return { ...current, input_audio_transcription: transcription };
  });

export const getTranscriptionPrompt = (
  parameters: AgentParameters | null | undefined,
): string => {
  if (!parameters) {
    return "";
  }
  const realtime = (parameters as Record<string, unknown>).realtime;
  if (!isPlainRecord(realtime)) {
    return "";
  }
  const transcription = realtime.input_audio_transcription;
  if (!isPlainRecord(transcription)) {
    return "";
  }
  const prompt = (transcription as Record<string, unknown>).prompt;
  if (typeof prompt === "string") {
    return prompt;
  }
  return "";
};

export const setTranscriptionPrompt = (
  parameters: AgentParameters,
  prompt: string,
): AgentParameters =>
  updateVoiceRealtimeConfig(parameters, (current) => {
    const transcription = isPlainRecord(current.input_audio_transcription)
      ? { ...(current.input_audio_transcription as Record<string, unknown>) }
      : {};
    if (prompt.trim()) {
      transcription.prompt = prompt;
    } else {
      delete transcription.prompt;
    }
    return { ...current, input_audio_transcription: transcription };
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
  const providerId = getAgentModelProviderId(rawParameters).trim();
  const providerSlug = getAgentModelProviderSlug(rawParameters).trim().toLowerCase();
  result = setAgentModelProvider(result, {
    providerId: providerId || null,
    providerSlug: providerSlug || null,
  });
  result = setVoiceAgentVoice(result, getVoiceAgentVoice(rawParameters));
  result = setVoiceAgentStartBehavior(result, getVoiceAgentStartBehavior(rawParameters));
  result = setVoiceAgentStopBehavior(result, getVoiceAgentStopBehavior(rawParameters));

  const tools = getVoiceAgentTools(rawParameters);
  for (const tool of VOICE_AGENT_TOOL_KEYS) {
    result = setVoiceAgentToolEnabled(result, tool, tools[tool]);
  }

  result = setTranscriptionModel(result, getTranscriptionModel(rawParameters));
  result = setTranscriptionLanguage(result, getTranscriptionLanguage(rawParameters));
  result = setTranscriptionPrompt(result, getTranscriptionPrompt(rawParameters));

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
    // Only skip if trimmed values are empty, but preserve original spacing
    if (!key.trim() || !value.trim()) {
      continue;
    }
    entries.push([key, value]);
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
    const key = assignment.identifier;
    const value = assignment.expression;
    // Only skip if trimmed values are empty, but preserve original spacing
    if (key.trim() && value.trim()) {
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
  "ssh",
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

  // SSH-specific fields
  if (typeof config.ssh_host === "string" && config.ssh_host.trim()) {
    payload.ssh_host = config.ssh_host.trim();
  }
  if (typeof config.ssh_port === "number" && config.ssh_port > 0 && config.ssh_port <= 65535) {
    payload.ssh_port = config.ssh_port;
  }
  if (typeof config.ssh_username === "string" && config.ssh_username.trim()) {
    payload.ssh_username = config.ssh_username.trim();
  }
  if (typeof config.ssh_password === "string" && config.ssh_password) {
    payload.ssh_password = config.ssh_password;
  }
  if (typeof config.ssh_private_key === "string" && config.ssh_private_key.trim()) {
    payload.ssh_private_key = config.ssh_private_key.trim();
  }

  return payload;
};

const coerceServerId = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const isPersistedMcpTool = (
  value: unknown,
): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) {
    return false;
  }
  const type = value.type;
  if (typeof type !== "string" || type.trim().toLowerCase() !== "mcp") {
    return false;
  }
  const directId = coerceServerId((value as Record<string, unknown>).server_id);
  if (directId !== null) {
    return true;
  }
  const server = (value as Record<string, unknown>).server;
  if (isPlainRecord(server)) {
    const nestedId = coerceServerId((server as Record<string, unknown>).id);
    if (nestedId !== null) {
      return true;
    }
  }
  return false;
};

const extractPersistedMcpServerId = (
  tool: Record<string, unknown>,
): number | null => {
  const direct = coerceServerId(tool.server_id);
  if (direct !== null) {
    return direct;
  }
  const server = tool.server;
  if (isPlainRecord(server)) {
    return coerceServerId((server as Record<string, unknown>).id);
  }
  return null;
};

const normalizeToolNames = (input: unknown): string[] => {
  const seen = new Set<string>();
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed) {
          seen.add(trimmed);
        }
      }
    }
  }
  return Array.from(seen.values());
};

const extractPersistedMcpToolNames = (
  tool: Record<string, unknown>,
): string[] => {
  const allow = tool.allow ?? tool.allowlist;
  if (isPlainRecord(allow)) {
    const candidates = (allow as Record<string, unknown>).tools;
    const names = normalizeToolNames(Array.isArray(candidates) ? candidates : []);
    if (names.length > 0) {
      return names;
    }
  }
  const cached = tool.tool_names;
  if (Array.isArray(cached)) {
    const names = normalizeToolNames(cached);
    if (names.length > 0) {
      return names;
    }
  }
  return [];
};

const sanitizeMcpServerConfig = (
  config: McpSseToolConfig | null | undefined,
): McpSseToolConfig | null => {
  if (!config) {
    return null;
  }
  const serverId = coerceServerId(config.serverId);
  if (serverId === null) {
    return null;
  }
  const toolNames = normalizeToolNames(config.toolNames ?? []);
  const authorization =
    typeof config.authorizationOverride === "string"
      ? config.authorizationOverride.trim()
      : "";
  const payload: McpSseToolConfig = {
    serverId,
    toolNames,
  };
  if (authorization) {
    payload.authorizationOverride = authorization;
  }
  return payload;
};

const buildPersistedMcpToolEntry = (
  config: McpSseToolConfig,
): Record<string, unknown> => {
  const entry: Record<string, unknown> = {
    type: "mcp",
    transport: "http_sse",
    server_id: config.serverId,
    server: { id: config.serverId },
  };

  if (config.toolNames.length > 0) {
    entry.allow = { tools: [...config.toolNames] };
    entry.tool_names = [...config.toolNames];
  }

  if (config.authorizationOverride) {
    entry.authorization = config.authorizationOverride;
    entry.authorization_override = config.authorizationOverride;
  }

  return entry;
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

  if (typeof config.partial_images === "number") {
    sanitized.partial_images = config.partial_images;
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

    // SSH-specific fields
    const sshHost = (source as Record<string, unknown>).ssh_host;
    if (typeof sshHost === "string" && sshHost.trim()) {
      result.ssh_host = sshHost.trim();
    }
    const sshPort = (source as Record<string, unknown>).ssh_port;
    if (typeof sshPort === "number" && sshPort > 0 && sshPort <= 65535) {
      result.ssh_port = sshPort;
    }
    const sshUsername = (source as Record<string, unknown>).ssh_username;
    if (typeof sshUsername === "string" && sshUsername.trim()) {
      result.ssh_username = sshUsername.trim();
    }
    const sshPassword = (source as Record<string, unknown>).ssh_password;
    if (typeof sshPassword === "string" && sshPassword) {
      result.ssh_password = sshPassword;
    }
    const sshPrivateKey = (source as Record<string, unknown>).ssh_private_key;
    if (typeof sshPrivateKey === "string" && sshPrivateKey.trim()) {
      result.ssh_private_key = sshPrivateKey.trim();
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
    if (typeof source.partial_images === "number") {
      config.partial_images = source.partial_images;
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

export const getAgentMcpServers = (
  parameters: AgentParameters | null | undefined,
): McpSseToolConfig[] => {
  if (!parameters) {
    return [];
  }

  const tools = (parameters as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  const normalized = new Map<number, McpSseToolConfig>();

  for (const tool of tools) {
    if (!isPersistedMcpTool(tool)) {
      continue;
    }

    const record = tool as Record<string, unknown>;
    const serverId = extractPersistedMcpServerId(record);
    if (serverId === null) {
      continue;
    }

    const toolNames = extractPersistedMcpToolNames(record);

    let authorization: string | undefined;
    const rawAuthorization = record.authorization ?? record.authorization_override;
    if (typeof rawAuthorization === "string") {
      const trimmed = rawAuthorization.trim();
      if (trimmed) {
        authorization = trimmed;
      }
    }

    const payload: McpSseToolConfig = {
      serverId,
      toolNames,
    };

    if (authorization) {
      payload.authorizationOverride = authorization;
    }

    normalized.set(serverId, payload);
  }

  return Array.from(normalized.values());
};

export const setAgentMcpServers = (
  parameters: AgentParameters,
  configs: McpSseToolConfig[],
): AgentParameters => {
  const next = { ...parameters } as AgentParameters;
  const tools = Array.isArray(next.tools)
    ? ([...(next.tools as unknown[])] as unknown[])
    : [];

  const preserved = tools.filter((tool) => !isPersistedMcpTool(tool));

  const normalized = new Map<number, McpSseToolConfig>();
  configs.forEach((config) => {
    const sanitized = sanitizeMcpServerConfig(config);
    if (!sanitized) {
      return;
    }
    normalized.set(sanitized.serverId, sanitized);
  });

  const sanitizedConfigs = Array.from(normalized.values());

  if (sanitizedConfigs.length === 0) {
    if (preserved.length === 0) {
      const { tools: _ignored, ...rest } = next as Record<string, unknown>;
      return stripEmpty(rest);
    }
    return { ...next, tools: preserved };
  }

  const entries = sanitizedConfigs.map(buildPersistedMcpToolEntry);
  return { ...next, tools: [...preserved, ...entries] };
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

// Model selection mode: 'specific' (default) or 'user_choice'
export type ModelSelectionMode = 'specific' | 'user_choice';

export type UserModelOptionSettings = {
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  reasoning?: {
    effort?: string;
    summary?: string;
  };
  text_verbosity?: string;
  truncation?: string;
};

export type UserModelOption = {
  id: string;
  label: string;
  description?: string;
  model: string;
  provider_id?: string;
  provider_slug?: string;
  default?: boolean;
  model_settings?: UserModelOptionSettings;
};

export const getAgentModelSelectionMode = (
  parameters: AgentParameters | null | undefined,
): ModelSelectionMode => {
  if (!parameters) {
    return 'specific';
  }
  const mode = (parameters as Record<string, unknown>).model_selection_mode;
  if (mode === 'user_choice') {
    return 'user_choice';
  }
  return 'specific';
};

export const setAgentModelSelectionMode = (
  parameters: AgentParameters,
  mode: ModelSelectionMode,
): AgentParameters => {
  if (mode === 'specific') {
    const { model_selection_mode: _ignored, ...rest } = parameters;
    return stripEmpty(rest);
  }
  return { ...parameters, model_selection_mode: mode };
};

export const getAgentUserModelOptions = (
  parameters: AgentParameters | null | undefined,
): UserModelOption[] => {
  if (!parameters) {
    return [];
  }
  const options = (parameters as Record<string, unknown>).user_model_options;
  if (!Array.isArray(options)) {
    return [];
  }
  return options.filter(
    (opt): opt is UserModelOption =>
      isPlainRecord(opt) &&
      typeof (opt as Record<string, unknown>).id === 'string' &&
      typeof (opt as Record<string, unknown>).label === 'string' &&
      typeof (opt as Record<string, unknown>).model === 'string',
  );
};

export const setAgentUserModelOptions = (
  parameters: AgentParameters,
  options: UserModelOption[],
): AgentParameters => {
  if (options.length === 0) {
    const { user_model_options: _ignored, ...rest } = parameters;
    return stripEmpty(rest);
  }
  return { ...parameters, user_model_options: options };
};

export const addAgentUserModelOption = (
  parameters: AgentParameters,
  option: UserModelOption,
): AgentParameters => {
  const existing = getAgentUserModelOptions(parameters);
  return setAgentUserModelOptions(parameters, [...existing, option]);
};

export const removeAgentUserModelOption = (
  parameters: AgentParameters,
  optionId: string,
): AgentParameters => {
  const existing = getAgentUserModelOptions(parameters);
  return setAgentUserModelOptions(
    parameters,
    existing.filter((opt) => opt.id !== optionId),
  );
};

export const updateAgentUserModelOption = (
  parameters: AgentParameters,
  optionId: string,
  updates: Partial<UserModelOption>,
): AgentParameters => {
  const existing = getAgentUserModelOptions(parameters);
  return setAgentUserModelOptions(
    parameters,
    existing.map((opt) =>
      opt.id === optionId ? { ...opt, ...updates } : opt,
    ),
  );
};
