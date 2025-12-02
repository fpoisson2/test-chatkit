import type { SchemaProperty } from "../components/SchemaBuilder";

type JsonSchema = Record<string, unknown> | null | undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const detectPropertyType = (prop: Record<string, unknown>): SchemaProperty["type"] => {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    return "enum";
  }

  switch (prop.type) {
    case "array":
      return "array";
    case "object":
      return "object";
    case "boolean":
      return "boolean";
    case "number":
    case "integer":
      return "number";
    case "string":
    default:
      return "string";
  }
};

const normalizeSchemaSource = (candidate: JsonSchema): JsonSchema => {
  if (!isPlainObject(candidate)) return candidate;

  if (isPlainObject(candidate.json_schema) && isPlainObject(candidate.json_schema.schema)) {
    return candidate.json_schema.schema;
  }

  if (isPlainObject(candidate.schema)) {
    return candidate.schema;
  }

  return candidate;
};

const jsonPropertyToVisual = (
  name: string,
  prop: Record<string, unknown>,
  requiredList: string[] | undefined,
): SchemaProperty => {
  const type = detectPropertyType(prop);
  const base: SchemaProperty = {
    name,
    type,
    description: typeof prop.description === "string" ? prop.description : "",
    required: Boolean(requiredList?.includes(name)),
  };

  if (type === "enum" && Array.isArray(prop.enum)) {
    base.enum = prop.enum.map((value) => String(value));
  }

  if (type === "object" && isPlainObject(prop.properties)) {
    const nestedRequired = Array.isArray(prop.required)
      ? (prop.required as string[])
      : undefined;
    base.properties = Object.entries(prop.properties).map(([childName, childProp]) =>
      jsonPropertyToVisual(childName, childProp as Record<string, unknown>, nestedRequired),
    );
  }

  if (type === "array" && isPlainObject(prop.items)) {
    const itemsProp = prop.items as Record<string, unknown>;
    base.items = jsonPropertyToVisual("item", itemsProp, undefined);
  }

  return base;
};

/**
 * Convert a JSON Schema (possibly wrapped in a json_schema object) to the visual schema format
 */
export function jsonToVisualSchema(jsonSchema: any): SchemaProperty[] {
  const normalized = normalizeSchemaSource(jsonSchema);
  if (!isPlainObject(normalized) || !isPlainObject(normalized.properties)) return [];

  const requiredList = Array.isArray(normalized.required)
    ? (normalized.required as string[])
    : undefined;

  return Object.entries(normalized.properties).map(([name, prop]) =>
    jsonPropertyToVisual(name, prop as Record<string, unknown>, requiredList),
  );
}

const visualPropertyToJson = (prop: SchemaProperty): Record<string, unknown> => {
  const jsonProp: Record<string, unknown> = {
    type: prop.type === "enum" ? "string" : prop.type,
  };

  if (prop.description?.trim()) {
    jsonProp.description = prop.description;
  }

  if (prop.type === "enum" && Array.isArray(prop.enum)) {
    const values = prop.enum.map((value) => value.trim()).filter(Boolean);
    if (values.length > 0) {
      jsonProp.enum = values;
    }
  }

  if (prop.type === "object" && prop.properties?.length) {
    const nestedProperties: Record<string, unknown> = {};
    const nestedRequired: string[] = [];
    prop.properties.forEach((nested) => {
      nestedProperties[nested.name] = visualPropertyToJson(nested);
      if (nested.required) {
        nestedRequired.push(nested.name);
      }
    });

    jsonProp.properties = nestedProperties;
    if (nestedRequired.length > 0) {
      jsonProp.required = nestedRequired;
    }
  }

  if (prop.type === "array" && prop.items) {
    jsonProp.items = visualPropertyToJson(prop.items);
  }

  return jsonProp;
};

/**
 * Convert visual schema format to JSON Schema
 */
export function visualToJsonSchema(visualSchema: SchemaProperty[]): any {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  visualSchema.forEach((prop) => {
    properties[prop.name] = visualPropertyToJson(prop);
    if (prop.required) {
      required.push(prop.name);
    }
  });

  const base: Record<string, unknown> = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    base.required = required;
  }

  return base;
}