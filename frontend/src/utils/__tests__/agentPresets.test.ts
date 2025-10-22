import { describe, expect, it } from "vitest";

import { resolveStateParameters } from "../agentPresets";

describe("resolveStateParameters", () => {
  it("renvoie un objet vide lorsqu'aucun preset n'est défini", () => {
    const resolved = resolveStateParameters("maj-etat-triage", null);
    expect(resolved).toEqual({});
  });

  it("préserve les affectations fournies pour les slugs hérités", () => {
    const payload = {
      state: [
        { target: "state.custom_flag", expression: "input.value" },
      ],
      globals: [
        { target: "global.ready", expression: "true" },
      ],
    } as const;

    const resolved = resolveStateParameters("maj-etat-validation", payload);
    expect(resolved).toEqual({
      state: [
        { target: "state.custom_flag", expression: "input.value" },
      ],
      globals: [
        { target: "global.ready", expression: "true" },
      ],
    });
  });

  it("laisse intacts les paramètres pour un slug inconnu", () => {
    const payload = {
      state: [
        { target: "state.untracked", expression: "raw.value" },
      ],
      globals: [
        { target: "global.flag", expression: "true" },
      ],
    } as const;

    const resolved = resolveStateParameters("etat-personnalise", payload);
    expect(resolved).toEqual({
      state: [
        { target: "state.untracked", expression: "raw.value" },
      ],
      globals: [
        { target: "global.flag", expression: "true" },
      ],
    });
  });
});
