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

  it("prefers button identifiers derived from keys", () => {
    const buttonWidget: Record<string, unknown> = {
      type: "Card",
      children: [
        {
          type: "Row",
          children: [
            {
              type: "Button",
              key: "opt1",
              label: "Option 1",
              text: "Option 1",
              iconStart: "sparkle",
            },
            {
              type: "Button",
              onClickAction: { type: "menu.select", payload: { id: "opt2" } },
              label: "Option 2",
              text: "Option 2",
              iconStart: "bolt",
            },
          ],
        },
      ],
    };
    const bindings = collectWidgetBindings(buttonWidget);
    expect(Object.keys(bindings).sort()).toEqual(["opt1", "opt1.icon", "opt2", "opt2.icon"]);
    expect(bindings.opt1.sample).toBe("Option 1");
    expect(bindings["opt1.icon"].sample).toBe("sparkle");
    expect(bindings.opt2.sample).toBe("Option 2");
    expect(bindings["opt2.icon"].sample).toBe("bolt");
  });

  it("collects bindings for image sources and alt text", () => {
    const imageWidget: Record<string, unknown> = {
      type: "Card",
      size: "sm",
      padding: 0,
      children: [
        {
          type: "Image",
          src: "https://upload.wikimedia.org/wikipedia/commons/6/63/Aurora_Borealis.jpg",
          alt: "Aurore boréale vue de l'ISS (NASA)",
          fit: "cover",
          aspectRatio: 1.5,
          flush: true,
        },
      ],
    };

    const bindings = collectWidgetBindings(imageWidget);
    expect(Object.keys(bindings).sort()).toEqual(["image.alt", "image.src"]);
    expect(bindings["image.src"].sample).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/6/63/Aurora_Borealis.jpg",
    );
    expect(bindings["image.alt"].sample).toBe("Aurore boréale vue de l'ISS (NASA)");
    expect(bindings["image.src"].valueKey).toBe("src");
    expect(bindings["image.alt"].valueKey).toBe("alt");

    const updated = applyWidgetInputValues(
      imageWidget,
      {
        "image.src": "https://example.com/new-image.jpg",
        "image.alt": "Nouvelle image",
      },
      bindings,
    );

    const [image] = (updated.children as Array<Record<string, unknown>>);
    expect(image.src).toBe("https://example.com/new-image.jpg");
    expect(image.alt).toBe("Nouvelle image");
  });

  it("collects bindings from component ids and editable fields", () => {
    const bindings = collectWidgetBindings(definition);
    expect(Object.keys(bindings).sort()).toEqual([
      "caption",
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
      caption: "Détails",
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
    const updated = applyWidgetInputValues(
      definition,
      {
        title: "Nouveau titre",
        description: "Nouvelle description",
        item_a: ["X", "Y"],
        caption: "Note",
      },
      collectWidgetBindings(definition),
    );
    const children = updated.children as Array<Record<string, unknown>>;
    expect(children[0].value).toBe("Nouveau titre");
    expect(children[1].value).toBe("Nouvelle description");
    expect(children[2].value).toEqual(["X", "Y"]);
    expect(children[3].value).toBe("Note");
    // Ensure original definition is not mutated.
    const originalChildren = definition.children as Array<Record<string, unknown>>;
    expect(originalChildren[0].value).toBe("Titre");
  });

  it("applies updates to button labels and icons", () => {
    const buttonWidget: Record<string, unknown> = {
      type: "Card",
      children: [
        {
          type: "Row",
          children: [
            {
              type: "Button",
              key: "opt1",
              label: "Option 1",
              text: "Option 1",
              iconStart: "sparkle",
            },
            {
              type: "Button",
              onClickAction: { type: "menu.select", payload: { id: "opt2" } },
              label: "Option 2",
              text: "Option 2",
              iconStart: "bolt",
            },
          ],
        },
      ],
    };

    const bindings = collectWidgetBindings(buttonWidget);
    const updated = applyWidgetInputValues(
      buttonWidget as Record<string, unknown>,
      {
        opt1: "Choix A",
        "opt1.icon": "star",
        opt2: "Choix B",
        "opt2.icon": "zap",
      },
      bindings,
    );

    expect(bindings.opt1.valueKey).toBe("text");
    expect(bindings["opt1.icon"].valueKey).toBe("iconStart");
    expect(bindings.opt2.valueKey).toBe("text");
    expect(bindings["opt2.icon"].valueKey).toBe("iconStart");
    expect(bindings.opt1.path).toEqual(["children", 0, "children", 0]);
    expect(bindings.opt2.path).toEqual(["children", 0, "children", 1]);

    const row = (updated.children as Array<Record<string, unknown>>)[0];
    const [firstButton, secondButton] = row.children as Array<Record<string, unknown>>;
    expect(firstButton.label).toBe("Choix A");
    expect(firstButton.text).toBe("Choix A");
    expect(firstButton.iconStart).toBe("star");
    expect(secondButton.label).toBe("Choix B");
    expect(secondButton.text).toBe("Choix B");
    expect(secondButton.iconStart).toBe("zap");
  });
});
