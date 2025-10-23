import { describe, expect, it } from "vitest";

import type { AgentParameters } from "../workflows";
import {
  createVoiceAgentParameters,
  DEFAULT_VOICE_AGENT_MODEL,
  DEFAULT_VOICE_AGENT_START_BEHAVIOR,
  DEFAULT_VOICE_AGENT_STOP_BEHAVIOR,
  DEFAULT_VOICE_AGENT_VOICE,
  getAgentNestedWorkflow,
  getWidgetNodeConfig,
  resolveVoiceAgentParameters,
  resolveWidgetNodeParameters,
  setAgentNestedWorkflow,
  setWidgetNodeDefinitionExpression,
  setWidgetNodeSlug,
  setWidgetNodeSource,
} from "../workflows";

describe("widget_source override", () => {
  it("conserve la source \"variable\" tant que l'expression est vide", () => {
    const initial: AgentParameters = {};
    const updated = setWidgetNodeSource(initial, "variable");

    expect(updated).toEqual({ widget_source: "variable" });

    const config = getWidgetNodeConfig(updated);
    expect(config.source).toBe("variable");
    expect(config.definitionExpression).toBe("");
  });

  it("supprime la bascule lorsque l'expression est renseignée", () => {
    const initial: AgentParameters = {};
    const switched = setWidgetNodeSource(initial, "variable");
    const withExpression = setWidgetNodeDefinitionExpression(
      switched,
      '{"foo": "bar"}',
    );

    expect(withExpression).not.toHaveProperty("widget_source");

    const config = getWidgetNodeConfig(withExpression);
    expect(config.source).toBe("variable");
    expect(config.definitionExpression).toBe('{"foo": "bar"}');
  });

  it("retire l'override lors du retour sur la bibliothèque", () => {
    const initial: AgentParameters = {};
    const switched = setWidgetNodeSource(initial, "variable");
    const backToLibrary = setWidgetNodeSource(switched, "library");
    expect(backToLibrary).toEqual({});

    const withSlug = setWidgetNodeSlug(switched, "widget-demo");
    expect(withSlug).not.toHaveProperty("widget_source");
    expect(getWidgetNodeConfig(withSlug).source).toBe("library");
  });

  it("préserve l'override lors de la normalisation des paramètres", () => {
    const initial: AgentParameters = { widget_source: "variable" };
    const resolved = resolveWidgetNodeParameters(initial);
    expect(resolved).toEqual({ widget_source: "variable" });
    expect(getWidgetNodeConfig(resolved).source).toBe("variable");
  });
});

describe("nested workflow helpers", () => {
  it("normalise les références extraites des paramètres", () => {
    const reference = getAgentNestedWorkflow({
      workflow: { id: 42, slug: "  nested-flow  " },
    });

    expect(reference).toEqual({ id: 42, slug: "nested-flow" });
  });

  it("supprime la configuration lorsque aucun identifiant n'est fourni", () => {
    const initial: AgentParameters = { foo: "bar" };
    const withoutWorkflow = setAgentNestedWorkflow(initial, {
      id: null,
      slug: "  ",
    });

    expect(withoutWorkflow).toEqual({ foo: "bar" });
  });

  it("enregistre un slug nettoyé lorsqu'il est fourni sans identifiant", () => {
    const next = setAgentNestedWorkflow({}, { slug: "  nested-flow  " });

    expect(next).toEqual({ workflow: { slug: "nested-flow" } });
  });
});

describe("voice agent helpers", () => {
  it("returns default realtime configuration when creating parameters", () => {
    const parameters = createVoiceAgentParameters();

    expect(parameters).toEqual({
      model: DEFAULT_VOICE_AGENT_MODEL,
      voice: DEFAULT_VOICE_AGENT_VOICE,
      realtime: {
        start_mode: DEFAULT_VOICE_AGENT_START_BEHAVIOR,
        stop_mode: DEFAULT_VOICE_AGENT_STOP_BEHAVIOR,
        tools: {
          response: true,
          transcription: true,
          function_call: false,
        },
      },
    });
  });

  it("normalises realtime settings when resolving voice agent parameters", () => {
    const raw: AgentParameters = {
      model: "  gpt-4o-realtime-latest  ",
      voice: "  nova  ",
      instructions: "Follow the script",
      realtime: {
        start_mode: "invalid",
        stop_mode: "auto",
        tools: {
          transcription: 0,
        },
      },
    };

    const resolved = resolveVoiceAgentParameters(raw);

    expect(resolved).toEqual({
      model: "gpt-4o-realtime-latest",
      voice: "nova",
      instructions: "Follow the script",
      realtime: {
        start_mode: DEFAULT_VOICE_AGENT_START_BEHAVIOR,
        stop_mode: "auto",
        tools: {
          response: true,
          transcription: false,
          function_call: false,
        },
      },
    });
  });
});
