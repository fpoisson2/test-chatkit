import type { SchemaProperty } from "../components/SchemaBuilder";

/**
 * Convert a JSON Schema to visual schema format
 */
export function jsonToVisualSchema(jsonSchema: any): SchemaProperty[] {
  if (!jsonSchema || !jsonSchema.properties) return [];

  return Object.entries(jsonSchema.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type === "string" && prop.enum ? "enum" :
          prop.type === "array" ? "array" :
          prop.type === "object" ? "object" :
          prop.type === "boolean" ? "boolean" :
          prop.type === "number" ? "number" : "string",
    description: prop.description || "",
    required: jsonSchema.required?.includes(name) || false,
    enum: prop.enum || undefined,
    properties: prop.type === "object" && prop.properties ?
      Object.entries(prop.properties).map(([propName, propDef]: [string, any]) => ({
        name: propName,
        type: propDef.type === "string" && propDef.enum ? "enum" :
              propDef.type === "array" ? "array" :
              propDef.type === "object" ? "object" :
              propDef.type === "boolean" ? "boolean" :
              propDef.type === "number" ? "number" : "string",
        description: propDef.description || "",
        required: prop.required?.includes(propName) || false,
        enum: propDef.enum || undefined,
      })) : undefined,
    items: prop.type === "array" ? {
      name: "item",
      type: prop.items?.type === "object" ? "object" :
            prop.items?.type === "array" ? "array" :
            prop.items?.type === "boolean" ? "boolean" :
            prop.items?.type === "number" ? "number" : "string",
      description: "Élément du tableau"
    } : undefined,
  }));
}

/**
 * Convert visual schema format to JSON Schema
 */
export function visualToJsonSchema(visualSchema: SchemaProperty[]): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  visualSchema.forEach(prop => {
    if (prop.required) {
      required.push(prop.name);
    }

    const jsonProp: any = {
      type: prop.type === "enum" ? "string" : prop.type,
      description: prop.description || undefined,
    };

    if (prop.type === "enum" && prop.enum) {
      jsonProp.enum = prop.enum.filter(v => v.trim() !== "");
    }

    if (prop.type === "object" && prop.properties) {
      jsonProp.properties = {};
      const objRequired: string[] = [];
      prop.properties.forEach(nestedProp => {
        if (nestedProp.required) objRequired.push(nestedProp.name);
        jsonProp.properties[nestedProp.name] = {
          type: nestedProp.type === "enum" ? "string" : nestedProp.type,
          description: nestedProp.description || undefined,
        };
        if (nestedProp.type === "enum" && nestedProp.enum) {
          jsonProp.properties[nestedProp.name].enum = nestedProp.enum.filter(v => v.trim() !== "");
        }
      });
      if (objRequired.length > 0) {
        jsonProp.required = objRequired;
      }
    }

    if (prop.type === "array" && prop.items) {
      jsonProp.items = {
        type: prop.items.type === "enum" ? "string" : prop.items.type,
      };
    }

    properties[prop.name] = jsonProp;
  });

  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  };
}