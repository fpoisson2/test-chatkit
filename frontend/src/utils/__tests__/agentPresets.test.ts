import { describe, expect, it } from "vitest";

import { resolveStateParameters } from "../agentPresets";

const TRIAGE_STATE_DEFAULTS = [
  {
    target: "state.has_all_details",
    expression: "input.output_parsed.has_all_details",
  },
  {
    target: "state.infos_manquantes",
    expression: "input.output_text",
  },
  {
    target: "state.should_finalize",
    expression: "input.output_parsed.has_all_details",
  },
];

describe("resolveStateParameters", () => {
  it("applique les valeurs par défaut pour un bloc état connu", () => {
    const resolved = resolveStateParameters("maj-etat-triage", null);
    expect(resolved).toEqual({ state: TRIAGE_STATE_DEFAULTS });
  });

  it("permet de surcharger des expressions reconnues", () => {
    const resolved = resolveStateParameters("maj-etat-triage", {
      state: [
        { target: "state.has_all_details", expression: "output.success" },
        { target: "state.infos_manquantes", expression: "output.text" },
      ],
    });

    expect(resolved).toEqual({
      state: [
        { target: "state.has_all_details", expression: "output.success" },
        { target: "state.infos_manquantes", expression: "output.text" },
        {
          target: "state.should_finalize",
          expression: "input.output_parsed.has_all_details",
        },
      ],
    });
  });

  it("ignore les affectations inconnues pour les blocs préconfigurés", () => {
    const resolved = resolveStateParameters("maj-etat-triage", {
      state: [
        { target: "state.has_all_details", expression: "output.success" },
        { target: "state.extra", expression: "output.extra" },
      ],
    });

    expect(resolved).toEqual({
      state: [
        { target: "state.has_all_details", expression: "output.success" },
        {
          target: "state.infos_manquantes",
          expression: "input.output_text",
        },
        {
          target: "state.should_finalize",
          expression: "input.output_parsed.has_all_details",
        },
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
