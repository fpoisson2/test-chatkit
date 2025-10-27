import { describe, expect, it } from "vitest";

import type { AgentMcpToolConfig, AgentParameters } from "../workflows";
import {
  createVoiceAgentParameters,
  DEFAULT_VOICE_AGENT_MODEL,
  DEFAULT_VOICE_AGENT_START_BEHAVIOR,
  DEFAULT_VOICE_AGENT_STOP_BEHAVIOR,
  DEFAULT_VOICE_AGENT_VOICE,
  getAgentNestedWorkflow,
  getAgentWorkflowTools,
  getWidgetNodeConfig,
  resolveVoiceAgentParameters,
  resolveWidgetNodeParameters,
  setAgentNestedWorkflow,
  setAgentWorkflowTools,
  setWidgetNodeDefinitionExpression,
  setWidgetNodeSlug,
  setWidgetNodeSource,
  getAgentWorkflowValidationToolEnabled,
  setAgentWorkflowValidationToolEnabled,
  getStartTelephonyRoutes,
  setStartTelephonyRoutes,
  getStartTelephonyWorkflow,
  setStartTelephonyWorkflow,
  getStartTelephonyRealtimeOverrides,
  setStartTelephonyRealtimeOverrides,
  resolveStartParameters,
  getAgentMcpTools,
  setAgentMcpTools,
  validateAgentMcpTools,
  type WorkflowToolConfig,
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

describe("agent MCP tool helpers", () => {
  const baseConfig: AgentMcpToolConfig = {
    id: "mcp-test",
    transport: "hosted",
    serverLabel: "",
    serverUrl: "",
    connectorId: "",
    authorization: "",
    headersText: "",
    allowedToolsText: "",
    requireApprovalMode: "never",
    requireApprovalCustom: "",
    description: "",
    url: "",
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
  };

  it("extracts hosted, HTTP and stdio definitions from parameters", () => {
    const parameters: AgentParameters = {
      tools: [
        {
          type: "mcp",
          mcp: {
            kind: "hosted",
            server_label: "Docs",
            server_url: "https://example.com/mcp",
            connector_id: "connector-123",
            authorization: "Bearer 123",
            headers: { Authorization: "Bearer 123" },
            allowed_tools: ["search", "read"],
            require_approval: { default: "auto" },
          },
        },
        { type: "function", function: { name: "fetch_weather" } },
        {
          type: "mcp",
          url: "https://remote.example.com/mcp",
          headers: { "X-Api-Key": "secret" },
          allowed_tools: { allow: ["browse"] },
          require_approval: "always",
          mcp: {
            kind: "http",
            server_description: "Remote", 
          },
        },
        {
          type: "mcp",
          mcp: {
            kind: "stdio",
            server_label: "Local",
            command: "./run.sh",
            args: ["--serve"],
            env: { TOKEN: "abc" },
            cwd: "/srv/service",
          },
        },
      ],
    };

    const configs = getAgentMcpTools(parameters);

    expect(configs).toHaveLength(3);
    expect(configs[0]).toEqual(
      expect.objectContaining({
        transport: "hosted",
        serverLabel: "Docs",
        serverUrl: "https://example.com/mcp",
        connectorId: "connector-123",
        authorization: "Bearer 123",
        headersText: "Authorization: Bearer 123",
        allowedToolsText: "search\nread",
        requireApprovalMode: "custom",
        requireApprovalCustom: '{\n  "default": "auto"\n}',
      }),
    );

    expect(configs[1]).toEqual(
      expect.objectContaining({
        transport: "http",
        serverLabel: "",
        description: "Remote",
        url: "https://remote.example.com/mcp",
        headersText: "X-Api-Key: secret",
        allowedToolsText: expect.stringContaining("browse"),
        requireApprovalMode: "always",
      }),
    );

    expect(configs[2]).toEqual(
      expect.objectContaining({
        transport: "stdio",
        serverLabel: "Local",
        command: "./run.sh",
        argsText: "--serve",
        envText: "TOKEN: abc",
        cwd: "/srv/service",
      }),
    );
  });

  it("validates missing targets and malformed fields", () => {
    const configs: AgentMcpToolConfig[] = [
      {
        ...baseConfig,
        id: "mcp-1",
        serverLabel: "",
        transport: "hosted",
        serverUrl: "",
        connectorId: "",
        headersText: "missing", // invalid format (no separator)
        envText: "BAD",
        allowedToolsText: "{not-json}",
      },
      {
        ...baseConfig,
        id: "mcp-2",
        transport: "http",
        serverLabel: "Remote",
        url: "",
        requireApprovalMode: "custom",
        requireApprovalCustom: "not json",
      },
      {
        ...baseConfig,
        id: "mcp-3",
        transport: "stdio",
        serverLabel: "Local",
        command: "",
      },
    ];

    const validation = validateAgentMcpTools(configs);

    expect(validation).toEqual([
      {
        id: "mcp-1",
        errors: {
          serverLabel: "missing",
          connection: "missingTarget",
          headers: "invalid",
          env: "invalid",
          allowedTools: "invalid",
        },
      },
      {
        id: "mcp-2",
        errors: {
          connection: "missingUrl",
          requireApproval: "invalid",
        },
      },
      {
        id: "mcp-3",
        errors: {
          connection: "missingCommand",
        },
      },
    ]);
  });

  it("serialises MCP tools back into the agent parameters", () => {
    const parameters: AgentParameters = {
      tools: [
        { type: "function", function: { name: "fetch_weather" } },
        { type: "mcp", mcp: { kind: "http", server_label: "legacy" } },
      ],
    };

    const configs: AgentMcpToolConfig[] = [
      {
        ...baseConfig,
        id: "mcp-new",
        serverLabel: "Hosted",
        transport: "hosted",
        serverUrl: "https://api.example.com",
        connectorId: "connector-9",
        description: "Hosted API",
        authorization: "Bearer 123",
        headersText: "X-Test: value",
        allowedToolsText: "alpha\nbeta",
      },
      {
        ...baseConfig,
        id: "mcp-stdio",
        serverLabel: "Local",
        transport: "stdio",
        command: "./serve",
        argsText: "--port\n8080",
        envText: "TOKEN=abc",
        cwd: "/srv/app",
      },
    ];

    const next = setAgentMcpTools(parameters, configs);

    expect(next.tools).toHaveLength(3);
    const [preserved, hosted, stdio] = next.tools ?? [];

    expect(preserved).toEqual({
      type: "function",
      function: { name: "fetch_weather" },
    });

    expect(hosted).toEqual({
      type: "mcp",
      mcp: expect.objectContaining({
        kind: "hosted",
        server_label: "Hosted",
        server_url: "https://api.example.com",
        connector_id: "connector-9",
        server_description: "Hosted API",
        authorization: "Bearer 123",
        headers: { "X-Test": "value" },
        ui_headers_text: "X-Test: value",
        ui_allowed_tools: "alpha\nbeta",
        allowed_tools: ["alpha", "beta"],
      }),
    });

    expect(stdio).toEqual({
      type: "mcp",
      mcp: expect.objectContaining({
        kind: "stdio",
        server_label: "Local",
        command: "./serve",
        args: ["--port", "8080"],
        env: { TOKEN: "abc" },
        ui_env_text: "TOKEN=abc",
        cwd: "/srv/app",
      }),
    });
  });
});
