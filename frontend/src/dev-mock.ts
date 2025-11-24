// Script de développement pour tester le workflow-builder sans backend
// Ce fichier configure un utilisateur admin mock et intercepte les appels API

import type {
  AppearanceSettings,
  AvailableModel,
  WidgetTemplate,
  WidgetTemplateSummary,
  VectorStoreSummary,
  WorkflowAppearance,
  WorkflowAppearanceOverride,
  WorkflowAppearanceUpdatePayload
} from './utils/backend';
import {
  COMPUTER_USE_WIDGET_DEFAULT_DESCRIPTION,
  COMPUTER_USE_WIDGET_DEFAULT_TITLE,
  COMPUTER_USE_WIDGET_SLUG,
} from './constants/widgets';

// Données mockées pour le développement
const MOCK_MODELS: AvailableModel[] = [
  {
    id: 1,
    name: 'gpt-4',
    display_name: 'GPT-4',
    description: 'Modèle le plus puissant',
    provider_id: 'openai-default',
    provider_slug: 'openai',
    supports_reasoning: true,
    supports_previous_response_id: true,
    supports_reasoning_summary: true,
    store: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'gpt-3.5-turbo',
    display_name: 'GPT-3.5 Turbo',
    description: 'Modèle rapide et efficace',
    provider_id: 'openai-default',
    provider_slug: 'openai',
    supports_reasoning: false,
    supports_previous_response_id: true,
    supports_reasoning_summary: true,
    store: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    name: 'claude-3-5-sonnet-20241022',
    display_name: 'Claude 3.5 Sonnet',
    description: 'Modèle Claude performant',
    provider_id: 'anthropic-proxy',
    provider_slug: 'litellm',
    supports_reasoning: true,
    supports_previous_response_id: false,
    supports_reasoning_summary: false,
    store: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const MOCK_WIDGETS: WidgetTemplate[] = [
  {
    slug: 'sample-widget',
    title: 'Sample Widget',
    description: 'Un widget d\'exemple pour le développement',
    definition: {
      type: 'container',
      children: [
        { type: 'text', content: 'Hello from mock widget!' }
      ]
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    slug: COMPUTER_USE_WIDGET_SLUG,
    title: COMPUTER_USE_WIDGET_DEFAULT_TITLE,
    description: COMPUTER_USE_WIDGET_DEFAULT_DESCRIPTION,
    definition: {
      type: 'ComputerUse',
      startUrl: 'https://www.google.com',
      width: 1280,
      height: 720,
      title: COMPUTER_USE_WIDGET_DEFAULT_TITLE,
      description: COMPUTER_USE_WIDGET_DEFAULT_DESCRIPTION,
      autoStart: true,
      enableInput: true,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const MOCK_WIDGET_SUMMARIES: WidgetTemplateSummary[] = MOCK_WIDGETS.map(w => ({
  slug: w.slug,
  title: w.title,
  description: w.description,
}));

const MOCK_VECTOR_STORES: VectorStoreSummary[] = [
  {
    slug: 'sample-store',
    title: 'Sample Vector Store',
    description: 'Un store d\'exemple',
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    documents_count: 0,
  },
];

const MOCK_APPEARANCE_TIMESTAMP = new Date().toISOString();

const MOCK_APPEARANCE: AppearanceSettings = {
  color_scheme: 'system',
  accent_color: '#2563eb',
  use_custom_surface_colors: false,
  surface_hue: 222,
  surface_tint: 92,
  surface_shade: 16,
  heading_font: '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  body_font: '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  start_screen_greeting: '',
  start_screen_prompt: '',
  start_screen_placeholder: 'Posez votre question...',
  start_screen_disclaimer: '',
  created_at: MOCK_APPEARANCE_TIMESTAMP,
  updated_at: MOCK_APPEARANCE_TIMESTAMP,
};

type WorkflowAppearanceRecord = {
  metadata: {
    kind: 'local' | 'hosted';
    slug: string;
    label: string;
    workflowId: number | null;
    remoteWorkflowId: string | null;
  };
  override: WorkflowAppearanceOverride | null;
};

const workflowAppearanceState = new Map<string, WorkflowAppearanceRecord>();

const ensureWorkflowAppearanceRecord = (reference: string): WorkflowAppearanceRecord => {
  const normalized = reference.trim();
  const existing = workflowAppearanceState.get(normalized);
  if (existing) {
    return existing;
  }

  const numericId = Number(normalized);
  const isNumeric = Number.isFinite(numericId) && normalized !== '';
  const record: WorkflowAppearanceRecord = {
    metadata: {
      kind: isNumeric ? 'local' : 'hosted',
      slug: isNumeric ? 'demo-workflow' : normalized,
      label: isNumeric ? 'Demo Workflow' : normalized,
      workflowId: isNumeric ? numericId : null,
      remoteWorkflowId: isNumeric ? null : normalized,
    },
    override: null,
  };

  workflowAppearanceState.set(normalized, record);
  return record;
};

const mergeAppearanceSettings = (
  override: WorkflowAppearanceOverride | null,
): AppearanceSettings => ({
  ...MOCK_APPEARANCE,
  ...(override
    ? {
        color_scheme: override.color_scheme ?? MOCK_APPEARANCE.color_scheme,
        accent_color: override.accent_color ?? MOCK_APPEARANCE.accent_color,
        use_custom_surface_colors:
          override.use_custom_surface_colors ?? MOCK_APPEARANCE.use_custom_surface_colors,
        surface_hue: override.surface_hue ?? MOCK_APPEARANCE.surface_hue,
        surface_tint: override.surface_tint ?? MOCK_APPEARANCE.surface_tint,
        surface_shade: override.surface_shade ?? MOCK_APPEARANCE.surface_shade,
        heading_font: override.heading_font ?? MOCK_APPEARANCE.heading_font,
        body_font: override.body_font ?? MOCK_APPEARANCE.body_font,
        start_screen_greeting: override.start_screen_greeting ?? '',
        start_screen_prompt: override.start_screen_prompt ?? '',
        start_screen_placeholder:
          override.start_screen_placeholder ?? MOCK_APPEARANCE.start_screen_placeholder,
        start_screen_disclaimer: override.start_screen_disclaimer ?? '',
      }
    : {}),
});

const hasAppearanceOverrides = (override: WorkflowAppearanceOverride): boolean =>
  [
    override.color_scheme,
    override.accent_color,
    override.use_custom_surface_colors,
    override.surface_hue,
    override.surface_tint,
    override.surface_shade,
    override.heading_font,
    override.body_font,
    override.start_screen_greeting,
    override.start_screen_prompt,
    override.start_screen_placeholder,
    override.start_screen_disclaimer,
  ].some((value) => value !== null && value !== undefined);

const buildWorkflowAppearancePayload = (
  reference: string,
  record: WorkflowAppearanceRecord,
): WorkflowAppearance => ({
  target_kind: record.metadata.kind,
  workflow_id: record.metadata.workflowId,
  workflow_slug: record.metadata.slug,
  label: record.metadata.label,
  remote_workflow_id: record.metadata.remoteWorkflowId,
  override: record.override,
  effective: mergeAppearanceSettings(record.override),
  inherited_from_global: record.override == null,
});

const applyWorkflowAppearanceUpdate = (
  reference: string,
  payload: WorkflowAppearanceUpdatePayload,
): WorkflowAppearance => {
  const record = ensureWorkflowAppearanceRecord(reference);

  if (payload.inherit_from_global) {
    record.override = null;
    return buildWorkflowAppearancePayload(reference, record);
  }

  const now = new Date().toISOString();
  const base: WorkflowAppearanceOverride =
    record.override ?? {
      color_scheme: null,
      accent_color: null,
      use_custom_surface_colors: null,
      surface_hue: null,
      surface_tint: null,
      surface_shade: null,
      heading_font: null,
      body_font: null,
      start_screen_greeting: null,
      start_screen_prompt: null,
      start_screen_placeholder: null,
      start_screen_disclaimer: null,
      created_at: now,
      updated_at: now,
    };

  const next: WorkflowAppearanceOverride = {
    ...base,
    updated_at: now,
  };

  if (Object.prototype.hasOwnProperty.call(payload, 'color_scheme')) {
    next.color_scheme = payload.color_scheme ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'accent_color')) {
    next.accent_color = payload.accent_color ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'use_custom_surface_colors')) {
    next.use_custom_surface_colors = payload.use_custom_surface_colors ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surface_hue')) {
    next.surface_hue = payload.surface_hue ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surface_tint')) {
    next.surface_tint = payload.surface_tint ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'surface_shade')) {
    next.surface_shade = payload.surface_shade ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'heading_font')) {
    next.heading_font = payload.heading_font ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'body_font')) {
    next.body_font = payload.body_font ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'start_screen_greeting')) {
    next.start_screen_greeting = payload.start_screen_greeting ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'start_screen_prompt')) {
    next.start_screen_prompt = payload.start_screen_prompt ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'start_screen_placeholder')) {
    next.start_screen_placeholder = payload.start_screen_placeholder ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'start_screen_disclaimer')) {
    next.start_screen_disclaimer = payload.start_screen_disclaimer ?? null;
  }

  if (!hasAppearanceOverrides(next)) {
    record.override = null;
  } else {
    next.created_at = base.created_at ?? now;
    record.override = next;
  }

  return buildWorkflowAppearancePayload(reference, record);
};

// Configuration de l'utilisateur admin mock
export const setupMockAuth = () => {
  const mockUser = {
    id: 1,
    email: 'admin@dev.local',
    is_admin: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockToken = 'mock-dev-token';

  localStorage.setItem('chatkit:auth:token', mockToken);
  localStorage.setItem('chatkit:auth:user', JSON.stringify(mockUser));

  console.log('✅ Mock auth configured:', mockUser.email);
};

// Stockage en mémoire pour la persistance pendant la session
const workflowVersionsStorage = new Map<string, any>();

// Initialiser une version par défaut
const getDefaultVersionData = (workflowId: number, versionId: number) => ({
  id: versionId,
  workflow_id: workflowId,
  workflow_slug: 'demo-workflow',
  workflow_display_name: 'Demo Workflow',
  workflow_is_chatkit_default: false,
  name: 'Brouillon',
  version: 1,
  is_active: false,
  graph: {
    nodes: [
      {
        id: 1,
        slug: 'start',
        kind: 'start',
        display_name: 'Début',
        agent_key: null,
        is_enabled: true,
        parameters: {},
        metadata: { position: { x: 100, y: 100 } }
      },
      {
        id: 2,
        slug: 'end',
        kind: 'end',
        display_name: 'Fin',
        agent_key: null,
        is_enabled: true,
        parameters: {},
        metadata: { position: { x: 400, y: 100 } }
      }
    ],
    edges: []
  },
  steps: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

// Intercepteur de fetch pour mocker les réponses API
export const setupMockApi = () => {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method?.toUpperCase() || 'GET';
    const resolvedUrl = new URL(url, window.location.origin);
    const path = resolvedUrl.pathname;

    if (path === '/api/appearance-settings') {
      console.log('🔧 Mock API: GET /api/appearance-settings');
      const workflowReference = resolvedUrl.searchParams.get('workflow_id');
      if (workflowReference) {
        const record = ensureWorkflowAppearanceRecord(workflowReference);
        const payload = buildWorkflowAppearancePayload(workflowReference, record);
        return new Response(JSON.stringify(payload.effective), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(MOCK_APPEARANCE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const workflowAppearanceMatch = path.match(/^\/api\/workflows\/([^/]+)\/appearance$/);
    if (workflowAppearanceMatch) {
      const reference = decodeURIComponent(workflowAppearanceMatch[1]);
      if (method === 'GET') {
        console.log(`🔧 Mock API: GET ${path}`);
        const record = ensureWorkflowAppearanceRecord(reference);
        const payload = buildWorkflowAppearancePayload(reference, record);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PATCH') {
        console.log(`🔧 Mock API: PATCH ${path}`);
        let parsedBody: WorkflowAppearanceUpdatePayload = {};
        if (init?.body) {
          if (typeof init.body === 'string') {
            parsedBody = JSON.parse(init.body || '{}');
          } else if (init.body instanceof Blob) {
            parsedBody = JSON.parse(await init.body.text() || '{}');
          }
        }

        const payload = applyWorkflowAppearanceUpdate(reference, parsedBody);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Mock /api/chatkit/workflow (GET)
    if (url.includes('/api/chatkit/workflow') || url.includes('/api/chatkit')) {
      console.log('🔧 Mock API: /api/chatkit/workflow');
      return new Response(JSON.stringify({
        workflow_id: 1,
        workflow_slug: 'default-workflow',
        workflow_display_name: 'Default Workflow',
        definition_id: 1,
        definition_version: 1,
        auto_start: false,
        auto_start_user_message: null,
        auto_start_assistant_message: null,
        updated_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mock /api/admin/users (GET)
    if (url.includes('/api/admin/users')) {
      console.log('🔧 Mock API: /api/admin/users');
      return new Response(JSON.stringify([
        {
          id: 1,
          email: 'admin@dev.local',
          is_admin: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mock des endpoints API
    if (url.includes('/api/admin/models')) {
      console.log(`🔧 Mock API: ${method} ${url}`);
      const idMatch = url.match(/\/api\/admin\/models\/(\d+)/);

      if (method === 'GET') {
        return new Response(JSON.stringify(MOCK_MODELS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST') {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const now = new Date().toISOString();
        const nextId =
          MOCK_MODELS.reduce((max, model) => Math.max(max, model.id), 0) + 1;
        const created = {
          id: nextId,
          name: body.name,
          display_name: body.display_name ?? null,
          description: body.description ?? null,
          provider_id: body.provider_id ?? null,
          provider_slug: body.provider_slug ?? null,
          supports_reasoning: Boolean(body.supports_reasoning),
          supports_previous_response_id: Boolean(
            body.supports_previous_response_id ?? true,
          ),
          supports_reasoning_summary: Boolean(
            body.supports_reasoning_summary ?? true,
          ),
          created_at: now,
          updated_at: now,
        } satisfies AvailableModel;
        MOCK_MODELS.push(created);
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'PATCH' && idMatch) {
        const modelId = Number.parseInt(idMatch[1] ?? '', 10);
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const index = MOCK_MODELS.findIndex((model) => model.id === modelId);
        if (index === -1) {
          return new Response(JSON.stringify({ detail: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const current = { ...MOCK_MODELS[index] };
        if (Object.prototype.hasOwnProperty.call(body, 'name')) {
          current.name = body.name ?? current.name;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'display_name')) {
          current.display_name = body.display_name ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'description')) {
          current.description = body.description ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'provider_id')) {
          current.provider_id = body.provider_id ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'provider_slug')) {
          current.provider_slug = body.provider_slug ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'supports_reasoning')) {
          current.supports_reasoning = Boolean(body.supports_reasoning);
        }
        if (
          Object.prototype.hasOwnProperty.call(
            body,
            'supports_previous_response_id',
          )
        ) {
          current.supports_previous_response_id = Boolean(
            body.supports_previous_response_id,
          );
        }
        if (
          Object.prototype.hasOwnProperty.call(
            body,
            'supports_reasoning_summary',
          )
        ) {
          current.supports_reasoning_summary = Boolean(
            body.supports_reasoning_summary,
          );
        }
        current.updated_at = new Date().toISOString();
        MOCK_MODELS[index] = current;
        return new Response(JSON.stringify(current), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'DELETE' && idMatch) {
        const modelId = Number.parseInt(idMatch[1] ?? '', 10);
        const index = MOCK_MODELS.findIndex((model) => model.id === modelId);
        if (index !== -1) {
          MOCK_MODELS.splice(index, 1);
        }
        return new Response(null, { status: 204 });
      }
    }

    if (url.includes('/api/models')) {
      console.log('🔧 Mock API: /api/models');
      return new Response(JSON.stringify(MOCK_MODELS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/widgets') && !url.includes('/api/workflow-widgets')) {
      console.log('🔧 Mock API: /api/widgets');
      return new Response(JSON.stringify(MOCK_WIDGETS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/workflow-widgets')) {
      console.log('🔧 Mock API: /api/workflow-widgets');
      return new Response(JSON.stringify(MOCK_WIDGET_SUMMARIES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/vector-stores')) {
      console.log('🔧 Mock API: /api/vector-stores');
      return new Response(JSON.stringify(MOCK_VECTOR_STORES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mock /api/workflows avec gestion POST/GET/PATCH et versions
    if (url.includes('/api/workflows')) {
      console.log(`🔧 Mock API: ${method} ${url}`);

      // GET /api/workflows/{id}/versions/{version_id} - Détail d'une version
      const versionDetailMatch = url.match(/\/api\/workflows\/(\d+)\/versions\/(\d+)$/);
      if (versionDetailMatch && method === 'GET') {
        const workflowId = parseInt(versionDetailMatch[1]);
        const versionId = parseInt(versionDetailMatch[2]);
        const storageKey = `${workflowId}-${versionId}`;

        // Récupérer depuis le stockage ou créer une version par défaut
        if (!workflowVersionsStorage.has(storageKey)) {
          workflowVersionsStorage.set(storageKey, getDefaultVersionData(workflowId, versionId));
        }

        const versionData = workflowVersionsStorage.get(storageKey);
        console.log('📦 Retrieved from storage:', storageKey, versionData.graph.nodes.length, 'nodes');

        return new Response(JSON.stringify(versionData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // PUT /api/workflows/{id}/versions/{version_id} - Sauvegarder une version
      if (versionDetailMatch && method === 'PUT') {
        const workflowId = parseInt(versionDetailMatch[1]);
        const versionId = parseInt(versionDetailMatch[2]);
        const storageKey = `${workflowId}-${versionId}`;
        const body = init?.body ? JSON.parse(init.body as string) : {};

        // Récupérer la version existante ou créer une nouvelle
        const existingVersion = workflowVersionsStorage.get(storageKey) || getDefaultVersionData(workflowId, versionId);

        // Mettre à jour avec les nouvelles données
        const updatedVersion = {
          ...existingVersion,
          name: body.name || existingVersion.name,
          version: body.version || existingVersion.version,
          is_active: body.is_active !== undefined ? body.is_active : existingVersion.is_active,
          graph: body.graph || existingVersion.graph,
          steps: body.steps || existingVersion.steps,
          updated_at: new Date().toISOString(),
        };

        // Sauvegarder dans le stockage
        workflowVersionsStorage.set(storageKey, updatedVersion);
        console.log('💾 Saved to storage:', storageKey, updatedVersion.graph.nodes.length, 'nodes', updatedVersion.graph.edges.length, 'edges');

        return new Response(JSON.stringify(updatedVersion), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /api/workflows/{id}/versions - Liste des versions d'un workflow
      const versionsMatch = url.match(/\/api\/workflows\/(\d+)\/versions$/);
      if (versionsMatch && method === 'GET') {
        const workflowId = parseInt(versionsMatch[1]);
        return new Response(JSON.stringify([
          {
            id: 1,
            workflow_id: workflowId,
            name: 'Brouillon',
            version: 1,
            is_active: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // POST /api/workflows/{id}/versions - Créer une nouvelle version
      if (versionsMatch && method === 'POST') {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const workflowId = parseInt(versionsMatch[1]);
        return new Response(JSON.stringify({
          id: Math.floor(Math.random() * 10000),
          workflow_id: workflowId,
          name: body.name || 'Nouvelle version',
          version: body.version || 2,
          is_active: body.is_active || false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // POST - Créer ou mettre à jour un workflow
      if (method === 'POST' && url.endsWith('/api/workflows')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const mockResponse = {
          id: body.id || Math.floor(Math.random() * 10000),
          slug: body.slug || 'new-workflow',
          display_name: body.display_name || 'New Workflow',
          description: body.description || null,
          active_version_id: body.active_version_id || null,
          active_version_number: body.active_version_number || null,
          is_chatkit_default: body.is_chatkit_default || false,
          versions_count: body.versions_count || 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...body
        };
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // POST /api/workflows/{id}/production - Promouvoir une version en production
      const productionMatch = url.match(/\/api\/workflows\/(\d+)\/production$/);
      if (productionMatch && method === 'POST') {
        const workflowId = parseInt(productionMatch[1]);
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const versionId = body.version_id || 1;
        const storageKey = `${workflowId}-${versionId}`;

        // Récupérer la version à promouvoir
        const versionToPromote = workflowVersionsStorage.get(storageKey) || getDefaultVersionData(workflowId, versionId);

        // Créer une nouvelle version "active" (production)
        const newProductionVersionId = versionId + 1000; // ID différent pour la version prod
        const productionVersion = {
          ...versionToPromote,
          id: newProductionVersionId,
          name: 'Production',
          version: versionToPromote.version,
          is_active: true,
          created_at: versionToPromote.created_at,
          updated_at: new Date().toISOString(),
        };

        // Sauvegarder la version de production
        const prodStorageKey = `${workflowId}-${newProductionVersionId}`;
        workflowVersionsStorage.set(prodStorageKey, productionVersion);

        console.log('🚀 Promoted to production:', prodStorageKey);

        return new Response(JSON.stringify(productionVersion), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // PATCH - Mettre à jour un workflow
      if (method === 'PATCH') {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return new Response(JSON.stringify({ success: true, ...body }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET - Retourner un workflow par défaut
      if (method === 'GET' && url.endsWith('/api/workflows')) {
        return new Response(JSON.stringify([
          {
            id: 1,
            slug: 'demo-workflow',
            display_name: 'Demo Workflow',
            description: null,
            active_version_id: null,
            active_version_number: null,
            is_chatkit_default: false,
            versions_count: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Pour les autres endpoints, utiliser le fetch original (ou retourner 404)
    console.log(`⚠️  Unhandled API call: ${method} ${url}`);
    return new Response(JSON.stringify({ detail: 'Not implemented in mock' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  console.log('✅ Mock API configured');
};

// Active les mocks en mode développement
export const enableDevMocks = () => {
  // Vérifier si les mocks doivent être activés
  const useMockApi = import.meta.env.VITE_USE_MOCK_API?.toLowerCase() === 'true';

  if (import.meta.env.DEV && useMockApi) {
    setupMockAuth();
    setupMockApi();
    console.log('🚀 Dev mocks enabled - Workflow Builder ready for testing!');
    console.log('📍 Navigate to: http://localhost:5183/workflows');
  } else if (import.meta.env.DEV) {
    console.log('ℹ️  Dev mocks disabled - Using real backend API');
  }
};
