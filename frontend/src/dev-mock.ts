// Script de développement pour tester le workflow-builder sans backend
// Ce fichier configure un utilisateur admin mock et intercepte les appels API

import type {
  AvailableModel,
  WidgetTemplate,
  WidgetTemplateSummary,
  VectorStoreSummary
} from './utils/backend';

// Données mockées pour le développement
const MOCK_MODELS: AvailableModel[] = [
  {
    id: 1,
    name: 'gpt-4',
    display_name: 'GPT-4',
    description: 'Modèle le plus puissant',
    supports_reasoning: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'gpt-3.5-turbo',
    display_name: 'GPT-3.5 Turbo',
    description: 'Modèle rapide et efficace',
    supports_reasoning: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    name: 'claude-3-5-sonnet-20241022',
    display_name: 'Claude 3.5 Sonnet',
    description: 'Modèle Claude performant',
    supports_reasoning: true,
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

// Initialiser une version initiale
const getDefaultVersionData = (workflowId: number, versionId: number) => ({
  id: versionId,
  workflow_id: workflowId,
  workflow_slug: 'demo-workflow',
  workflow_display_name: 'Workflow démo',
  workflow_is_chatkit_default: true,
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

    // Mock /api/chatkit/workflow (GET)
    if (url.includes('/api/chatkit/workflow') || url.includes('/api/chatkit')) {
      console.log('🔧 Mock API: /api/chatkit/workflow');
      return new Response(JSON.stringify({
        workflow_id: 1,
        workflow_slug: 'demo-workflow',
        workflow_display_name: 'Workflow démo',
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

        // Récupérer depuis le stockage ou créer une version de démonstration
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

      // GET - Retourner un workflow de démonstration
      if (method === 'GET' && url.endsWith('/api/workflows')) {
        return new Response(JSON.stringify([
          {
            id: 1,
            slug: 'demo-workflow',
            display_name: 'Workflow démo',
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
