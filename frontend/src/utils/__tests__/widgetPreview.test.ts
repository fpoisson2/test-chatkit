import { describe, expect, it } from "vitest";

import {
  applyWidgetInputValues,
  buildWidgetInputSample,
  collectWidgetBindings,
  sanitizeWidgetInputValues,
} from "../widgetPreview";

describe("widgetPreview helpers", () => {
  const definition: Record<string, unknown> = {
    type: "Card",
    children: [
      { type: "Text", id: "title", value: "Titre" },
      {
        type: "Markdown",
        editable: { name: "description" },
        value: "**Résumé**",
      },
      {
        type: "List",
        editable: { names: ["item_a", "item_b"] },
        value: ["A", "B"],
      },
      {
        type: "Caption",
        value: "Détails",
      },
    ],
  };

  it("collects bindings from component ids and editable fields", () => {
    const bindings = collectWidgetBindings(definition);
    expect(Object.keys(bindings).sort()).toEqual([
      "children.3.value",
      "description",
      "item_a",
      "item_b",
      "title",
    ]);
  });

  it("builds a sample input JSON using default values", () => {
    const bindings = collectWidgetBindings(definition);
    const sample = buildWidgetInputSample(definition, bindings);
    expect(sample).toEqual({
      title: "Titre",
      description: "**Résumé**",
      item_a: ["A", "B"],
      item_b: ["A", "B"],
      "children.3.value": "Détails",
    });
  });

  it("sanitizes arbitrary user input", () => {
    const sanitized = sanitizeWidgetInputValues({
      title: 42,
      item_a: ["alpha", 12, false],
      unknown: { nested: true },
    });
    expect(sanitized).toEqual({
      title: "42",
      item_a: ["alpha", "12", "false"],
    });
  });

  it("applies custom values to the widget definition", () => {
    const updated = applyWidgetInputValues(definition, {
      title: "Nouveau titre",
      description: "Nouvelle description",
      item_a: ["X", "Y"],
      "children.3.value": "Note",
    }, collectWidgetBindings(definition));
    const children = updated.children as Array<Record<string, unknown>>;
    expect(children[0].value).toBe("Nouveau titre");
    expect(children[1].value).toBe("Nouvelle description");
    expect(children[2].value).toEqual(["X", "Y"]);
    expect(children[3].value).toBe("Note");
    // Ensure original definition is not mutated.
    const originalChildren = definition.children as Array<Record<string, unknown>>;
    expect(originalChildren[0].value).toBe("Titre");
  });
});
