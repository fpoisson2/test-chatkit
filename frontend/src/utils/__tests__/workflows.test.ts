import { describe, expect, it } from "vitest";

import type { AgentParameters } from "../workflows";
import {
  createVoiceAgentParameters,
  DEFAULT_VOICE_AGENT_MODEL,
  DEFAULT_VOICE_AGENT_START_BEHAVIOR,
  DEFAULT_VOICE_AGENT_STOP_BEHAVIOR,
  DEFAULT_VOICE_AGENT_VOICE,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSCRIPTION_LANGUAGE,
  getAgentNestedWorkflow,
  getAgentMcpServers,
  getAgentWorkflowTools,
  getWidgetNodeConfig,
  getEndAgsConfig,
  resolveVoiceAgentParameters,
  resolveWidgetNodeParameters,
  setAgentNestedWorkflow,
  setAgentMcpServers,
  setAgentWorkflowTools,
  setWidgetNodeDefinitionExpression,
  setWidgetNodeSlug,
  setWidgetNodeSource,
  setEndAgsVariableId,
  setEndAgsScoreExpression,
  setEndAgsMaximumExpression,
  getAgentWorkflowValidationToolEnabled,
  setAgentWorkflowValidationToolEnabled,
  getStartTelephonyRoutes,
  setStartTelephonyRoutes,
  getStartTelephonyWorkflow,
  setStartTelephonyWorkflow,
  getStartTelephonyRealtimeOverrides,
  setStartTelephonyRealtimeOverrides,
  resolveStartParameters,
  type WorkflowToolConfig,
  type McpSseToolConfig,
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

describe("start telephony helpers", () => {
  it("normalise les numéros extraits des paramètres", () => {
    const parameters: AgentParameters = {
      telephony: {
        routes: ["  +33123456789  ", "+14155551234", ""],
      },
    };

    expect(getStartTelephonyRoutes(parameters)).toEqual([
      "+33123456789",
      "+14155551234",
    ]);
  });

  it("met à jour les numéros de téléphonie en supprimant les doublons", () => {
    const initial: AgentParameters = {};

    const updated = setStartTelephonyRoutes(initial, [
      "  +33123456789  ",
      "+33123456789",
      "",
    ]);

    expect(updated).toEqual({ telephony: { routes: ["+33123456789"] } });

    const cleared = setStartTelephonyRoutes(updated, []);
    expect(cleared).toEqual({});
  });

  it("normalise la cible workflow de la configuration téléphonie", () => {
    const parameters: AgentParameters = {
      telephony: {
        workflow: { id: 7, slug: "  voice-start  " },
      },
    };

    expect(getStartTelephonyWorkflow(parameters)).toEqual({
      id: 7,
      slug: "voice-start",
    });
  });

  it("enregistre et efface la cible workflow de la configuration téléphonie", () => {
    const initial: AgentParameters = {};

    const configured = setStartTelephonyWorkflow(initial, {
      id: 12,
      slug: "  voice-start  ",
    });

    expect(configured).toEqual({
      telephony: {
        workflow: { id: 12, slug: "voice-start" },
      },
    });

    const cleared = setStartTelephonyWorkflow(configured, { id: null, slug: "   " });
    expect(cleared).toEqual({});
  });

  it("normalise les overrides realtime", () => {
    const parameters: AgentParameters = {
      telephony: {
        realtime: {
          model: "  gpt-4o-realtime-preview  ",
          voice: "  alloy  ",
          start_mode: "invalid",
          stop_mode: "auto",
        },
      },
    };

    expect(getStartTelephonyRealtimeOverrides(parameters)).toEqual({
      model: "gpt-4o-realtime-preview",
      voice: "alloy",
      start_mode: null,
      stop_mode: "auto",
    });
  });

  it("met à jour et efface les overrides realtime", () => {
    const initial: AgentParameters = {};

    const configured = setStartTelephonyRealtimeOverrides(initial, {
      model: "  gpt-4o  ",
      voice: "alloy",
      start_mode: "auto",
    });

    expect(configured).toEqual({
      telephony: {
        realtime: {
          model: "gpt-4o",
          voice: "alloy",
          start_mode: "auto",
        },
      },
    });

    const cleared = setStartTelephonyRealtimeOverrides(configured, {
      model: "",
      voice: "",
      start_mode: null,
      stop_mode: null,
    });

    expect(cleared).toEqual({});
  });

  it("normalise l'ensemble des paramètres start", () => {
    const raw: AgentParameters = {
      auto_start: "true",
      auto_start_user_message: "  Bonjour  ",
      telephony: {
        routes: ["  +33123456789  ", ""],
        workflow: { slug: "  voice-start  " },
        realtime: {
          model: "  gpt-4o  ",
          stop_mode: "invalid",
        },
      },
    };

    const resolved = resolveStartParameters(raw);

    expect(resolved).toEqual({
      auto_start: true,
      auto_start_user_message: "Bonjour",
      telephony: {
        routes: ["+33123456789"],
        workflow: { slug: "voice-start" },
        realtime: {
          model: "gpt-4o",
        },
      },
    });
  });
});

describe("end AGS helpers", () => {
  it("extracts the AGS configuration from parameters", () => {
    const parameters: AgentParameters = {
      ags: {
        score_variable_id: "  quiz-final  ",
        value: " state.grade.score ",
        maximum: 20,
        comment: " state.grade.comment ",
      },
    };

    expect(getEndAgsConfig(parameters)).toEqual({
      variableId: "quiz-final",
      valueExpression: "state.grade.score",
      maximumExpression: "20",
      commentExpression: "state.grade.comment",
    });
  });

  it("falls back to legacy AGS keys", () => {
    const parameters: AgentParameters = {
      ags: {
        variable_id: "legacy-id",
        score: " state.score ",
        score_value: null,
        max_score: " 40 ",
        note: true,
      },
    };

    expect(getEndAgsConfig(parameters)).toEqual({
      variableId: "legacy-id",
      valueExpression: "state.score",
      maximumExpression: "40",
      commentExpression: "true",
    });
  });

  it("updates and clears AGS fields", () => {
    const withVariable = setEndAgsVariableId({}, " quiz-final ");
    expect(withVariable).toEqual({ ags: { score_variable_id: "quiz-final" } });

    const withScore = setEndAgsScoreExpression(withVariable, " state.grade.score ");
    expect(withScore).toEqual({
      ags: {
        score_variable_id: "quiz-final",
        value: "state.grade.score",
      },
    });

    const withMaximum = setEndAgsMaximumExpression(withScore, " 20 ");
    expect(withMaximum).toEqual({
      ags: {
        score_variable_id: "quiz-final",
        value: "state.grade.score",
        maximum: "20",
      },
    });

    const clearedScore = setEndAgsScoreExpression(withMaximum, "   ");
    expect(clearedScore).toEqual({
      ags: {
        score_variable_id: "quiz-final",
        maximum: "20",
      },
    });

    const clearedVariable = setEndAgsVariableId(clearedScore, "");
    expect(clearedVariable).toEqual({
      ags: {
        maximum: "20",
      },
    });

    const clearedMaximum = setEndAgsMaximumExpression(clearedVariable, "");
    expect(clearedMaximum).toEqual({});
  });
});

describe("mcp server helpers", () => {
  it("extrait les serveurs persistés et ignore les entrées héritées", () => {
    const parameters: AgentParameters = {
      tools: [
        {
          type: "mcp",
          transport: "http_sse",
          server_id: 7,
          authorization: "  Bearer foo  ",
          allow: { tools: ["Alpha", "beta  ", "", 42] },
        },
        {
          type: "mcp",
          server: { id: " 8 " },
          tool_names: ["gamma", "gamma"],
          authorization_override: " override ",
        },
        {
          type: "mcp",
          transport: "http_sse",
          url: "https://legacy.example/mcp",
        },
        { type: "function", function: { name: "other" } },
      ],
    };

    expect(getAgentMcpServers(parameters)).toEqual([
      {
        serverId: 7,
        toolNames: ["Alpha", "beta"],
        authorizationOverride: "Bearer foo",
      },
      {
        serverId: 8,
        toolNames: ["gamma"],
        authorizationOverride: "override",
      },
    ]);
  });

  it("met à jour la liste des serveurs tout en préservant les autres outils", () => {
    const baseTool = { type: "function", function: { name: "other" } };
    const legacyTool = {
      type: "mcp",
      transport: "http_sse",
      url: "https://legacy.example/mcp",
    };

    const initial: AgentParameters = { tools: [baseTool, legacyTool] };

    const updated = setAgentMcpServers(initial, [
      { serverId: 4, toolNames: ["alpha", "alpha"], authorizationOverride: "   " },
      { serverId: 3, toolNames: [], authorizationOverride: "token" },
      { serverId: 4, toolNames: ["beta"] },
    ]);

    expect(updated).toEqual({
      tools: [
        baseTool,
        legacyTool,
        {
          type: "mcp",
          transport: "http_sse",
          server_id: 4,
          server: { id: 4 },
          allow: { tools: ["beta"] },
          tool_names: ["beta"],
        },
        {
          type: "mcp",
          transport: "http_sse",
          server_id: 3,
          server: { id: 3 },
          authorization: "token",
          authorization_override: "token",
        },
      ],
    });

    const cleared = setAgentMcpServers(updated, []);
    expect(cleared).toEqual({ tools: [baseTool, legacyTool] });

    const fullyCleared = setAgentMcpServers({ tools: [] }, []);
    expect(fullyCleared).toEqual({});
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
        input_audio_transcription: {
          model: DEFAULT_TRANSCRIPTION_MODEL,
          language: DEFAULT_TRANSCRIPTION_LANGUAGE,
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
        input_audio_transcription: {
          model: DEFAULT_TRANSCRIPTION_MODEL,
          language: DEFAULT_TRANSCRIPTION_LANGUAGE,
        },
      },
    });
  });
});

describe("workflow validation tool helpers", () => {
  it("detects when the workflow validation tool is enabled", () => {
    const parameters: AgentParameters = {
      tools: [
        {
          type: "function",
          function: {
            name: "validate_workflow_graph",
          },
        },
      ],
    };

    expect(getAgentWorkflowValidationToolEnabled(parameters)).toBe(true);
  });

  it("removes the workflow validation tool when disabled", () => {
    const parameters: AgentParameters = {
      tools: [
        {
          type: "function",
          function: {
            name: "validate_workflow_graph",
          },
        },
      ],
    };

    const next = setAgentWorkflowValidationToolEnabled(parameters, false);

    expect(getAgentWorkflowValidationToolEnabled(next)).toBe(false);
    expect(next).not.toHaveProperty("tools");
  });

  it("adds the workflow validation tool when enabled", () => {
    const parameters: AgentParameters = {};

    const next = setAgentWorkflowValidationToolEnabled(parameters, true);

    expect(getAgentWorkflowValidationToolEnabled(next)).toBe(true);
    expect(next.tools).toEqual([
      {
        type: "function",
        function: {
          name: "validate_workflow_graph",
          description:
            "Valide un graphe de workflow ChatKit et retourne la version normalisée.",
        },
      },
    ]);
  });
});

describe("workflow tool helpers", () => {
  it("extracts workflow configurations from parameters", () => {
    const parameters: AgentParameters = {
      tools: [
        {
          type: "workflow",
          slug: "support",
          name: "Support",
          description: "Handle support conversations",
          workflow: { slug: "support", title: "Support" },
        },
      ],
    };

    expect(getAgentWorkflowTools(parameters)).toEqual([
      expect.objectContaining({
        slug: "support",
        name: "Support",
        description: "Handle support conversations",
        title: "Support",
      }),
    ]);
  });

  it("preserves other tools when setting workflow tools", () => {
    const parameters: AgentParameters = {
      tools: [
        {
          type: "function",
          function: { name: "fetch_weather" },
        },
      ],
    };

    const configs: WorkflowToolConfig[] = [
      { slug: "support", name: "Support" },
      { slug: "billing", name: "Billing" },
    ];

    const next = setAgentWorkflowTools(parameters, configs);

    expect(next.tools).toHaveLength(3);
    expect(next.tools?.[0]).toEqual(parameters.tools?.[0]);
    expect(getAgentWorkflowTools(next).map((config) => config.slug)).toEqual([
      "billing",
      "support",
    ]);
  });

  it("sanitises workflow tool names for API compatibility", () => {
    const configs: WorkflowToolConfig[] = [
      {
        slug: "customer-support",
        name: "Customer Support",
        identifier: "customer support",
      },
      {
        slug: "démo",
        name: "Démo Workflow",
        identifier: "démo",
        workflowId: 42,
      },
    ];

    const next = setAgentWorkflowTools({}, configs);

    expect(next.tools).toEqual([
      expect.objectContaining({
        type: "workflow",
        slug: "customer-support",
        name: "Customer_Support",
      }),
      expect.objectContaining({
        type: "workflow",
        slug: "démo",
        name: "Demo_Workflow",
      }),
    ]);

    expect(getAgentWorkflowTools(next)).toEqual([
      expect.objectContaining({ slug: "customer-support", name: "Customer_Support" }),
      expect.objectContaining({ slug: "démo", name: "Demo_Workflow" }),
    ]);
  });

  it("removes workflow tools when the configuration list is empty", () => {
    const parameters: AgentParameters = {
      tools: [
        { type: "workflow", slug: "support", workflow: { slug: "support" } },
        { type: "function", function: { name: "fetch_weather" } },
      ],
    };

    const next = setAgentWorkflowTools(parameters, []);

    expect(getAgentWorkflowTools(next)).toEqual([]);
    expect(next.tools).toEqual([
      { type: "function", function: { name: "fetch_weather" } },
    ]);
  });
});
