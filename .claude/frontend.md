# Frontend Documentation

## Architecture

React 18 SPA with TypeScript, built with Vite. Entry point: `frontend/src/main.tsx`

## Directory Structure

```
frontend/src/
├── main.tsx              # React entry point
├── App.tsx               # Main routing
├── MyChat.tsx            # Chat interface (main component)
├── auth.tsx              # Authentication helper
├── pages/                # Route pages
├── features/             # Feature modules
│   ├── workflow-builder/ # Visual workflow editor (React Flow)
│   ├── workflows/        # Workflow management
│   ├── appearance/       # Theme customization
│   └── settings/         # Settings management
├── components/           # Reusable components
├── chatkit/              # ChatKit integration
│   ├── api/              # ChatKit API client
│   ├── components/       # ChatKit UI components
│   ├── hooks/            # ChatKit hooks
│   ├── types/            # ChatKit types
│   └── widgets/          # ChatKit widgets
├── hooks/                # Custom React hooks (27 files)
├── schemas/              # Zod validation schemas
├── types/                # TypeScript definitions
├── utils/                # Utility functions
├── i18n/                 # Internationalization
├── voice/                # Voice interaction (realtime, WebRTC)
└── styles/               # CSS files (52 files)
```

## Key Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `MyChat.tsx` | Chat interface |
| `/workflows` | `WorkflowBuilderPage.tsx` | Visual workflow editor |
| `/vector-stores` | `VectorStoresPage.tsx` | Knowledge base management |
| `/settings` | `SettingsPage.tsx` | User preferences |
| `/login` | `LoginPage.tsx` | Authentication |
| `/admin/*` | Various | Admin panels |
| `/lti/launch` | `LTILaunchPage.tsx` | LTI launch endpoint |

## State Management

### Server State (TanStack React Query)

```typescript
// Example: useWorkflows hook
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useWorkflows() {
  const queryClient = useQueryClient();

  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  });

  const createMutation = useMutation({
    mutationFn: createWorkflow,
    onSuccess: () => queryClient.invalidateQueries(['workflows']),
  });

  return { workflows, createWorkflow: createMutation.mutate };
}
```

### Client State (Context API)

- `useAuth()` - Authentication state
- `AppearanceSettingsContext` - Theme settings
- `useAdminModal()` - Admin modal visibility
- `WorkflowSidebarProvider` - Sidebar state

## Key Custom Hooks (hooks/)

| Hook | Purpose |
|------|---------|
| `useWorkflows` | Workflow CRUD operations |
| `useChatkitSession` | Chat session management |
| `useModels` | Model configuration |
| `useMcpServers` | MCP server integration |
| `useVectorStores` | Knowledge base management |
| `useSipAccounts` | SIP account management |
| `useWorkflowMonitorWebSocket` | Real-time monitoring |
| `useWorkflowVoiceSession` | Voice conversations |
| `useOutboundCallSession` | Telephony calls |

## Form Handling

React Hook Form + Zod for validation:

```typescript
// Schema definition (schemas/workflow.ts)
import { z } from 'zod';

export const workflowSchema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
});

// Component usage
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const form = useForm({
  resolver: zodResolver(workflowSchema),
  defaultValues: { name: '', description: '' },
});
```

## Styling

- **CSS Modules**: Component-scoped styles (`*.module.css`)
- **Global styles**: `styles/styles.css` (93KB)
- **Radix UI**: Headless accessible components

```typescript
// Using CSS Modules
import styles from './Component.module.css';

function Component() {
  return <div className={styles.container}>...</div>;
}
```

## Workflow Builder (features/workflow-builder/)

Visual graph editor built with React Flow:
- `WorkflowEditor.tsx` - Main editor component
- `WorkflowCanvas.tsx` - React Flow canvas
- `EditorToolbar.tsx` - Editor toolbar
- Node types: agent, widget, message, start, end, assign, etc.

## ChatKit Integration (chatkit/)

Frontend SDK for ChatKit:
- `api/` - API client for ChatKit endpoints
- `components/` - Chat UI components
- `hooks/` - Session management hooks
- `widgets/` - Interactive widget implementations

## Adding a New Page

1. Create page component in `frontend/src/pages/`
2. Add route in `App.tsx`
3. Create Zod schema in `schemas/` if needed
4. Add custom hook in `hooks/` for data fetching

```typescript
// pages/NewPage.tsx
import { useNewFeature } from '../hooks/useNewFeature';

export function NewPage() {
  const { data, isLoading } = useNewFeature();

  if (isLoading) return <LoadingSpinner />;

  return (
    <AppLayout>
      {/* Page content */}
    </AppLayout>
  );
}

// App.tsx - Add route
<Route path="/new-feature" element={<NewPage />} />
```

## Testing

```bash
cd frontend
npm run test          # Run Vitest
npm run test:watch    # Watch mode
npm run lint          # TypeScript check
```

## Build

```bash
npm run frontend:build    # Production build to dist/
npm run frontend:preview  # Preview production build
```

## Environment Variables

Configured via Vite (`import.meta.env`):
- `VITE_API_URL` - Backend API URL
- `VITE_WS_URL` - WebSocket URL
