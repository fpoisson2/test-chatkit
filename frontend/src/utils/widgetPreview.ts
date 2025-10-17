import type { Widgets } from "@openai/chatkit";

export type WidgetBinding = {
  path: Array<string | number>;
  componentType: string | null;
  sample: string | string[] | null;
};

export type WidgetBindingMap = Record<string, WidgetBinding>;

const valueKeys = new Set<keyof Widgets.WidgetRoot | string>([
  "value",
  "text",
  "title",
  "label",
  "caption",
  "description",
  "body",
  "content",
  "heading",
  "subtitle",
  "icon",
  "iconStart",
  "iconEnd",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toSampleValue = (value: unknown): string | string[] | null => {
  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (typeof entry === "number" || typeof entry === "boolean") {
          return String(entry);
        }
        return null;
      })
      .filter((entry): entry is string => entry !== null);
    return sanitized.length > 0 ? sanitized : [];
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const getPathKey = (path: Array<string | number>): string => JSON.stringify(path);

const formatComponentIdentifier = (
  node: Record<string, unknown>,
  valueKey: string,
  bindings: WidgetBindingMap,
): string | null => {
  const componentType = typeof node.type === "string" ? node.type.trim() : null;

  const ensureUnique = (base: string): string => {
    if (!bindings[base]) {
      return base;
    }
    let index = 2;
    let candidate = `${base}_${index}`;
    while (bindings[candidate]) {
      index += 1;
      candidate = `${base}_${index}`;
    }
    return candidate;
  };

  const fromButton = (): string | null => {
    if (!componentType || componentType.toLowerCase() !== "button") {
      return null;
    }
    const keyAttr = typeof node.key === "string" ? node.key.trim() : null;
    let base = keyAttr && keyAttr.length > 0 ? keyAttr : null;
    if (!base) {
      const action = node.onClickAction;
      if (isRecord(action)) {
        const payload = action.payload;
        if (isRecord(payload)) {
          const candidate = typeof payload.id === "string" ? payload.id.trim() : null;
          if (candidate) {
            base = candidate;
          }
        }
      }
    }
    if (!base) {
      return null;
    }
    if (["label", "text", "title", "value"].includes(valueKey)) {
      return ensureUnique(base);
    }
    if (["icon", "iconStart", "iconEnd"].includes(valueKey)) {
      const suffix = valueKey === "iconEnd" ? "icon_end" : "icon";
      return ensureUnique(`${base}.${suffix}`);
    }
    return ensureUnique(`${base}.${valueKey}`);
  };

  const buttonIdentifier = fromButton();
  if (buttonIdentifier) {
    return buttonIdentifier;
  }

  if (componentType) {
    const aliasMap: Record<string, string> = {
      title: "title",
      subtitle: "subtitle",
      heading: "heading",
      text: "text",
      caption: "caption",
      markdown: "markdown",
      badge: "badge",
    };
    const alias = aliasMap[componentType.toLowerCase()];
    if (alias && ["value", "text", "title", "label", "content", "body"].includes(valueKey)) {
      return ensureUnique(alias);
    }
  }

  if (typeof node.name === "string" && node.name.trim().length > 0) {
    return ensureUnique(node.name.trim());
  }

  return null;
};

export const collectWidgetBindings = (definition: unknown): WidgetBindingMap => {
  const bindings: WidgetBindingMap = {};
  const manualPathKeys = new Set<string>();

  const register = (
    identifier: unknown,
    path: Array<string | number>,
    node: Record<string, unknown>,
    { isManual, valueKey }: { isManual: boolean; valueKey?: string },
  ) => {
    if (typeof identifier !== "string") {
      return;
    }
    const trimmedId = identifier.trim();
    if (!trimmedId) {
      return;
    }
    if (bindings[trimmedId]) {
      return;
    }
    const pathKey = getPathKey(path);
    if (!isManual && manualPathKeys.has(pathKey)) {
      return;
    }
    const componentType = typeof node.type === "string" ? node.type : null;
    let sample: string | string[] | null = null;
    const preferredKeys = valueKey ? [valueKey] : [];
    for (const key of [
      ...preferredKeys,
      "value",
      "text",
      "label",
      "src",
      "url",
      "href",
      "icon",
      "iconStart",
      "iconEnd",
    ]) {
      if (!(key in node)) {
        continue;
      }
      sample = toSampleValue(node[key]);
      if (sample !== null) {
        break;
      }
    }
    bindings[trimmedId] = {
      path: [...path],
      componentType,
      sample,
    };
    if (isManual) {
      manualPathKeys.add(pathKey);
    }
  };

  const walk = (node: unknown, path: Array<string | number>): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        if (typeof entry === "object" && entry !== null) {
          walk(entry, [...path, index]);
        }
      });
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    const identifier = typeof node.id === "string" ? node.id : null;
    if (identifier) {
      register(identifier, path, node, { isManual: true });
    }

    const editable = node.editable;
    if (isRecord(editable)) {
      const editableName = typeof editable.name === "string" ? editable.name : null;
      if (editableName) {
        register(editableName, path, node, { isManual: true });
      }
      const editableNames = editable.names;
      if (Array.isArray(editableNames)) {
        editableNames.forEach((entry) => {
          if (typeof entry === "string") {
            register(entry, path, node, { isManual: true });
          }
        });
      } else if (typeof editableNames === "string") {
        register(editableNames, path, node, { isManual: true });
      }
    }

    const nameAttr = typeof node.name === "string" ? node.name : null;
    if (nameAttr) {
      register(nameAttr, path, node, { isManual: true });
    }

    for (const key of valueKeys) {
      if (!(key in node)) {
        continue;
      }
      const rawValue = node[key as keyof typeof node];
      const identifierParts = [...path, key]
        .map((part) => String(part))
        .filter((part) => part.length > 0);
      const syntheticIdentifier = identifierParts.length === 0 ? null : identifierParts.join(".");
      const candidateIdentifier = formatComponentIdentifier(node, key, bindings) ?? syntheticIdentifier;
      if (!candidateIdentifier) {
        continue;
      }
      if (
        typeof rawValue === "string" ||
        typeof rawValue === "number" ||
        typeof rawValue === "boolean"
      ) {
        register(candidateIdentifier, path, node, { isManual: false, valueKey: key });
      } else if (Array.isArray(rawValue)) {
        const hasSimpleValue = rawValue.some(
          (item) =>
            typeof item === "string" || typeof item === "number" || typeof item === "boolean",
        );
        if (hasSimpleValue) {
          register(candidateIdentifier, path, node, { isManual: false, valueKey: key });
        }
      }
    }

    Object.entries(node).forEach(([key, child]) => {
      if (typeof child === "object" && child !== null) {
        walk(child, [...path, key]);
      }
    });
  };

  walk(definition, []);
  return bindings;
};

const sanitizeSample = (value: string | string[] | null): string | string[] => {
  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => (typeof entry === "string" ? entry : null))
      .filter((entry): entry is string => entry !== null);
    return sanitized;
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
};

export const buildWidgetInputSample = (
  definition: unknown,
  bindings?: WidgetBindingMap,
): Record<string, string | string[]> => {
  const source = bindings ?? collectWidgetBindings(definition);
  const result: Record<string, string | string[]> = {};
  for (const [identifier, binding] of Object.entries(source)) {
    result[identifier] = sanitizeSample(binding.sample);
  }
  return result;
};

export const sanitizeWidgetInputValues = (
  raw: unknown,
): Record<string, string | string[]> => {
  if (!isRecord(raw)) {
    return {};
  }
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string") {
      continue;
    }
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    if (Array.isArray(value)) {
      const sanitized = value
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (typeof entry === "number" || typeof entry === "boolean") {
            return String(entry);
          }
          return null;
        })
        .filter((entry): entry is string => entry !== null);
      result[trimmedKey] = sanitized;
    } else if (typeof value === "string") {
      result[trimmedKey] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[trimmedKey] = String(value);
    }
  }
  return result;
};

const cloneDefinition = <T>(definition: T): T => {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(definition);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("structuredClone a échoué, repli sur JSON", error);
      }
    }
  }
  return JSON.parse(JSON.stringify(definition)) as T;
};

const updateNodeValue = (node: Record<string, unknown>, value: string | string[]): void => {
  if (Array.isArray(value)) {
    node.value = value;
    return;
  }
  const text = value;
  if ("value" in node) {
    node.value = text;
  } else if ("text" in node) {
    node.text = text;
  } else {
    node.value = text;
  }
};

export const applyWidgetInputValues = (
  definition: Record<string, unknown>,
  values: Record<string, string | string[]>,
  bindings?: WidgetBindingMap,
): Record<string, unknown> => {
  const sanitized = sanitizeWidgetInputValues(values);
  const clone = cloneDefinition(definition);
  const matched = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    const identifier = typeof node.id === "string" ? node.id : null;
    if (identifier && identifier in sanitized) {
      updateNodeValue(node, sanitized[identifier]);
      matched.add(identifier);
    }

    const editable = node.editable;
    if (isRecord(editable)) {
      const editableName = typeof editable.name === "string" ? editable.name : null;
      if (editableName && editableName in sanitized && !matched.has(editableName)) {
        updateNodeValue(node, sanitized[editableName]);
        matched.add(editableName);
      }
      const editableNames = editable.names;
      if (Array.isArray(editableNames)) {
        const collected: string[] = [];
        editableNames.forEach((entry) => {
          if (typeof entry !== "string") {
            return;
          }
          const trimmed = entry.trim();
          if (!trimmed || !(trimmed in sanitized)) {
            return;
          }
          const value = sanitized[trimmed];
          if (Array.isArray(value)) {
            collected.push(...value);
          } else {
            collected.push(value);
          }
          matched.add(trimmed);
        });
        if (collected.length > 0) {
          updateNodeValue(node, collected);
        }
      } else if (
        typeof editableNames === "string" &&
        editableNames in sanitized &&
        !matched.has(editableNames)
      ) {
        updateNodeValue(node, sanitized[editableNames]);
        matched.add(editableNames);
      }
    }

    Object.values(node).forEach((child) => {
      if (typeof child === "object" && child !== null) {
        walk(child);
      }
    });
  };

  walk(clone);

  if (bindings) {
    for (const [identifier, binding] of Object.entries(bindings)) {
      if (matched.has(identifier)) {
        continue;
      }
      if (!(identifier in sanitized)) {
        continue;
      }
      let target: unknown = clone;
      let validPath = true;
      for (const step of binding.path) {
        if (typeof step === "string") {
          if (!isRecord(target) || !(step in target)) {
            validPath = false;
            break;
          }
          target = target[step];
        } else {
          if (!Array.isArray(target) || step < 0 || step >= target.length) {
            validPath = false;
            break;
          }
          target = target[step];
        }
      }
      if (!validPath || !isRecord(target)) {
        continue;
      }
      updateNodeValue(target, sanitized[identifier]);
      matched.add(identifier);
    }
  }

  return clone;
};
