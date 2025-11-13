import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { ChatKitOptions } from "@openai/chatkit";
import type { WorkflowSummary } from "../../../types/workflows";

vi.mock("../../../utils/device", () => ({
  getOrCreateDeviceId: () => "device-id",
}));

vi.mock("../../../auth", () => ({
  useAuth: () => ({ token: "test-token", user: { email: "user@example.com" } }),
}));

const mockOpenSidebar = vi.fn();
const mockSetHideSidebar = vi.fn();

vi.mock("../../../components/AppLayout", () => ({
  useAppLayout: () => ({ openSidebar: mockOpenSidebar, setHideSidebar: mockSetHideSidebar }),
}));

const capturedSidebarProps: {
  onWorkflowActivated?: (
    selection: any,
    options: { reason: "initial" | "user" },
  ) => void;
} = {};

vi.mock("../ChatSidebar", () => ({
  ChatSidebar: (props: any) => {
    capturedSidebarProps.onWorkflowActivated = props.onWorkflowActivated;
    return <div data-testid="chat-sidebar" />;
  },
}));

vi.mock("../OutboundCallAudioPlayer", () => ({
  OutboundCallAudioPlayer: () => <div data-testid="outbound-player" />,
}));

const mockSetAppearanceWorkflow = vi.fn();

vi.mock("../../../features/appearance/AppearanceSettingsContext", () => ({
  useAppearanceSettings: () => ({
    settings: {
      use_custom_surface_colors: false,
      surface_hue: 200,
      surface_tint: 90,
      surface_shade: 10,
      start_screen_placeholder: "",
      start_screen_greeting: "",
      start_screen_prompt: "",
      start_screen_disclaimer: "",
      accent_color: "#ff0000",
      body_font: "Inter",
    },
    setActiveWorkflow: mockSetAppearanceWorkflow,
    activeWorkflow: null,
  }),
}));

vi.mock("../../../hooks/usePreferredColorScheme", () => ({
  usePreferredColorScheme: () => "light",
}));

vi.mock("../../../hooks/useChatkitSession", () => ({
  useChatkitSession: () => ({
    getClientSecret: vi.fn(async () => "secret"),
    isLoading: false,
    error: null,
    reportError: vi.fn(),
    resetError: vi.fn(),
  }),
}));

const hostedFlowDisable = vi.fn();

vi.mock("../../../hooks/useHostedFlow", async () => {
  const React = await import("react");
  return {
    useHostedFlow: () => {
      const [mode, setMode] = React.useState<"local" | "hosted">("local");
      return { mode, setMode, hostedFlowEnabled: mode === "hosted", disableHostedFlow: hostedFlowDisable };
    },
  };
});

const chatkitOptionsBySlug = new Map<string, ChatKitOptions>();

vi.mock("../../../hooks/useWorkflowChatSession", () => ({
  useWorkflowChatSession: ({ chatkitOptions, activeWorkflow, mode }: any) => {
    const slug = activeWorkflow?.slug ?? `hosted:${mode}`;
    chatkitOptionsBySlug.set(slug, chatkitOptions);
    return {
      control: { threadId: chatkitOptions.initialThread ?? null, setThreadId: vi.fn() },
      fetchUpdates: vi.fn(),
      sendUserMessage: vi.fn(),
      requestRefresh: vi.fn(),
      chatkitWorkflowInfo: null,
    };
  },
}));

vi.mock("../../../hooks/useWorkflowVoiceSession", () => ({
  useWorkflowVoiceSession: () => ({
    stopVoiceSession: vi.fn(),
    status: "idle",
    isListening: false,
  }),
}));

vi.mock("../../../hooks/useOutboundCallSession", () => ({
  useOutboundCallSession: () => ({ callId: null, isActive: false }),
}));

vi.mock("../../../hooks/useChatApiConfig", () => ({
  useChatApiConfig: () => ({
    apiConfig: {} as ChatKitOptions["api"],
    attachmentsEnabled: true,
    debugSnapshot: { hostedFlow: false },
  }),
}));

vi.mock("@openai/chatkit-react", () => ({
  ChatKit: ({ control }: { control: { threadId: string | null } }) => (
    <div data-testid="mock-chatkit" data-thread-id={control.threadId ?? ""} />
  ),
}));

const renderWorkflows: Record<string, WorkflowSummary> = {
  one: {
    id: 1,
    slug: "workflow-one",
    display_name: "Workflow One",
    description: null,
    active_version_id: null,
    active_version_number: null,
    is_chatkit_default: false,
    lti_enabled: false,
    lti_registration_ids: [],
    lti_show_sidebar: true,
    lti_show_header: true,
    lti_enable_history: true,
    versions_count: 1,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  },
  two: {
    id: 2,
    slug: "workflow-two",
    display_name: "Workflow Two",
    description: null,
    active_version_id: null,
    active_version_number: null,
    is_chatkit_default: false,
    lti_enabled: false,
    lti_registration_ids: [],
    lti_show_sidebar: true,
    lti_show_header: true,
    lti_enable_history: true,
    versions_count: 1,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  },
};

const selectWorkflow = async (key: "one" | "two") => {
  const handler = capturedSidebarProps.onWorkflowActivated;
  if (!handler) {
    throw new Error("Sidebar handler not registered");
  }

  await act(async () => {
    handler({ kind: "local", workflow: renderWorkflows[key] }, { reason: "user" });
  });
};

const getChatkitOptions = async (slug: string) => {
  await waitFor(() => {
    expect(chatkitOptionsBySlug.get(slug)).toBeDefined();
  });
  return chatkitOptionsBySlug.get(slug)!;
};

vi.mock("../../../components/my-chat/ChatStatusMessage", () => ({
  ChatStatusMessage: () => <div data-testid="chat-status" />,
}));

beforeEach(() => {
  chatkitOptionsBySlug.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MyChat", () => {
  it("keeps inactive workflow hosts mounted until their thread completes", async () => {
    const { MyChat } = await import("../../../MyChat");
    const { container } = render(<MyChat />);

    await selectWorkflow("one");
    const optionsOne = await getChatkitOptions("workflow-one");
    await act(async () => {
      optionsOne.onThreadChange?.({ threadId: "thread-1" });
    });

    await selectWorkflow("two");
    await getChatkitOptions("workflow-two");

    const firstHost = container.querySelector('[data-chat-instance="workflow-one"]') as HTMLElement | null;
    const secondHost = container.querySelector('[data-chat-instance="workflow-two"]') as HTMLElement | null;

    expect(firstHost).not.toBeNull();
    expect(secondHost).not.toBeNull();
    expect(firstHost?.style.display).toBe("none");
    expect(secondHost?.style.display).not.toBe("none");

    await act(async () => {
      optionsOne.onThreadChange?.({ threadId: null });
    });

    await waitFor(() => {
      expect(container.querySelector('[data-chat-instance="workflow-one"]')).toBeNull();
    });

    expect(container.querySelector('[data-chat-instance="workflow-two"]')).not.toBeNull();
  });
});
