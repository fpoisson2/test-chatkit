export type WorkflowImportErrorReason =
  | "invalid_json"
  | "invalid_graph"
  | "missing_nodes"
  | "invalid_node"
  | "invalid_edge";

export class WorkflowImportError extends Error {
  readonly reason: WorkflowImportErrorReason;

  constructor(reason: WorkflowImportErrorReason) {
    super(reason);
    this.name = "WorkflowImportError";
    this.reason = reason;
  }
}

type JsonRecord = Record<string, unknown>;

type WorkflowImportNode = {
  slug: string;
  kind: string;
  display_name?: string | null;
  agent_key?: string | null;
  is_enabled?: boolean;
  parameters?: JsonRecord;
  metadata?: JsonRecord;
};

type WorkflowImportEdge = {
  source: string;
  target: string;
  condition?: string | null;
  metadata?: JsonRecord;
};

type WorkflowImportGraph = {
  nodes: WorkflowImportNode[];
  edges: WorkflowImportEdge[];
  repeat_zones?: WorkflowImportRepeatZone[];
};

type WorkflowImportRepeatZone = {
  id: string;
  label: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  node_slugs: string[];
  metadata: JsonRecord;
};

export type ParsedWorkflowImport = {
  graph: WorkflowImportGraph;
  workflowId?: number | null;
  slug?: string;
  displayName?: string;
  description?: string | null;
  versionName?: string;
  markAsActive?: boolean;
};

const isRecord = (value: unknown): value is JsonRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

const sanitizeRecord = (value: unknown): JsonRecord => {
  if (!isRecord(value)) {
    return {};
  }
  return { ...value };
};

const sanitizeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const sanitizeBounds = (value: unknown): { x: number; y: number; width: number; height: number } => {
  if (!isRecord(value)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = sanitizeNumber(value.width, 0);
  const height = sanitizeNumber(value.height, 0);
  return {
    x: sanitizeNumber(value.x, 0),
    y: sanitizeNumber(value.y, 0),
    width: width < 0 ? 0 : width,
    height: height < 0 ? 0 : height,
  };
};

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toTrimmedStringOrNull(entry))
    .filter((entry): entry is string => entry !== null);
};

const toTrimmedStringOrNull = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
};

const toTrimmedStringOrUndefined = (value: unknown): string | undefined => {
  const text = toTrimmedStringOrNull(value);
  return text === null ? undefined : text;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

export const parseWorkflowImport = (input: string): ParsedWorkflowImport => {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (_error) {
    throw new WorkflowImportError("invalid_json");
  }

  if (!isRecord(raw)) {
    throw new WorkflowImportError("invalid_graph");
  }

  const graphCandidate = isRecord(raw.graph) ? raw.graph : raw;
  const rawNodes = graphCandidate.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new WorkflowImportError("missing_nodes");
  }

  const rawEdges = graphCandidate.edges;
  if (!Array.isArray(rawEdges)) {
    throw new WorkflowImportError("invalid_graph");
  }

  const rawRepeatZones = graphCandidate.repeat_zones;
  const repeatZones: WorkflowImportRepeatZone[] = Array.isArray(rawRepeatZones)
    ? rawRepeatZones
        .map((entry) => {
          if (!isRecord(entry)) {
            return null;
          }
          const id = toTrimmedStringOrNull(entry.id);
          if (!id) {
            return null;
          }
          return {
            id,
            label: toTrimmedStringOrNull(entry.label),
            bounds: sanitizeBounds(entry.bounds),
            node_slugs: sanitizeStringArray(entry.node_slugs),
            metadata: sanitizeRecord(entry.metadata),
          } satisfies WorkflowImportRepeatZone;
        })
        .filter((zone): zone is WorkflowImportRepeatZone => zone !== null)
    : [];

  const nodes = rawNodes.map((entry) => {
    if (!isRecord(entry)) {
      throw new WorkflowImportError("invalid_node");
    }
    const slug = toTrimmedStringOrNull(entry.slug);
    const kind = toTrimmedStringOrNull(entry.kind);
    if (!slug || !kind) {
      throw new WorkflowImportError("invalid_node");
    }
    return {
      slug,
      kind,
      display_name: entry.display_name === undefined ? undefined : toTrimmedStringOrNull(entry.display_name),
      agent_key: entry.agent_key === undefined ? undefined : toTrimmedStringOrNull(entry.agent_key),
      is_enabled: entry.is_enabled === undefined ? undefined : Boolean(entry.is_enabled),
      parameters: sanitizeRecord(entry.parameters),
      metadata: sanitizeRecord(entry.metadata),
    } satisfies WorkflowImportNode;
  });

  const edges = rawEdges.map((entry) => {
    if (!isRecord(entry)) {
      throw new WorkflowImportError("invalid_edge");
    }
    const source = toTrimmedStringOrNull(entry.source);
    const target = toTrimmedStringOrNull(entry.target);
    if (!source || !target) {
      throw new WorkflowImportError("invalid_edge");
    }
    const condition = toTrimmedStringOrNull(entry.condition);
    return {
      source,
      target,
      condition,
      metadata: sanitizeRecord(entry.metadata),
    } satisfies WorkflowImportEdge;
  });

  const workflowId = toFiniteNumberOrNull(raw.workflow_id);
  const slug = toTrimmedStringOrUndefined(raw.slug ?? raw.workflow_slug);
  const displayName = toTrimmedStringOrUndefined(
    raw.display_name ?? raw.workflow_display_name,
  );
  const description =
    raw.description === undefined && raw.workflow_description === undefined
      ? undefined
      : toTrimmedStringOrNull(raw.description ?? raw.workflow_description);
  const versionName = toTrimmedStringOrUndefined(raw.version_name ?? raw.name);
  const markAsActive =
    raw.mark_as_active === undefined
      ? undefined
      : Boolean(raw.mark_as_active);

  return {
    graph: { nodes, edges, repeat_zones: repeatZones },
    workflowId,
    slug,
    displayName,
    description,
    versionName,
    markAsActive,
  } satisfies ParsedWorkflowImport;
};
