import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { AdminModelsPage } from "../AdminModelsPage";

const { listAdminMock, createMock, deleteMock, getSettingsMock } = vi.hoisted(() => ({
  listAdminMock: vi.fn(),
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock("../../auth", () => ({
  useAuth: () => ({ token: "test-token", logout: vi.fn() }),
}));

vi.mock("../../components/AdminTabs", () => ({
  AdminTabs: () => <div data-testid="admin-tabs" />,
}));

vi.mock("../../components/ManagementPageLayout", () => ({
  ManagementPageLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const translate = (key: string, params?: Record<string, string>) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name) => params?.[name] ?? `{{${name}}}`);

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => translate(key, params),
  }),
}));

vi.mock("../../utils/backend", () => ({
  modelRegistryApi: {
    listAdmin: listAdminMock,
    create: createMock,
    delete: deleteMock,
  },
  appSettingsApi: {
    get: getSettingsMock,
  },
  isUnauthorizedError: () => false,
}));

const baseSettings = {
  thread_title_prompt: "",
  default_thread_title_prompt: "",
  is_custom_thread_title_prompt: false,
  model_provider: "litellm",
  model_api_base: "",
  is_model_provider_overridden: false,
  is_model_api_base_overridden: false,
  is_model_api_key_managed: false,
  model_api_key_hint: null,
  model_providers: [
    {
      id: "primary",
      provider: "litellm",
      api_base: "http://localhost",
      api_key_hint: null,
      has_api_key: true,
      is_default: true,
    },
  ],
  sip_trunk_uri: null,
  sip_trunk_username: null,
  sip_trunk_password: null,
  sip_contact_host: null,
  sip_contact_port: null,
  sip_contact_transport: null,
  created_at: null,
  updated_at: null,
};

describe("AdminModelsPage", () => {
  beforeEach(() => {
    listAdminMock.mockResolvedValue([]);
    createMock.mockResolvedValue({
      id: 42,
      name: "gpt-4o-mini",
      display_name: "",
      description: null,
      provider_id: "primary",
      provider_slug: "litellm",
      supports_reasoning: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });
    deleteMock.mockResolvedValue(undefined);
    getSettingsMock.mockResolvedValue({ ...baseSettings });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads providers from settings and includes native OpenAI", async () => {
    render(<AdminModelsPage />);

    const providerSelect = await screen.findByLabelText(
      "admin.models.form.providerSelectLabel",
    );

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledWith("test-token");
    });

    await waitFor(() => {
      expect(providerSelect).toBeEnabled();
    });

    const openAiOption = await screen.findByRole("option", {
      name: "admin.models.form.providerOptionOpenAI",
    });
    expect(openAiOption).toHaveValue("openai");

    const defaultOption = screen.getByRole("option", {
      name: "admin.models.form.providerOptionWithDefault",
    });
    expect(defaultOption).toHaveValue("litellm");
    expect(providerSelect).toBeEnabled();
  });

  it("submits the selected provider slug and identifier", async () => {
    render(<AdminModelsPage />);

    const nameInput = await screen.findByLabelText(
      "admin.models.form.modelIdLabel",
    );

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "gpt-4o-mini");

    const providerSelect = await screen.findByLabelText(
      "admin.models.form.providerSelectLabel",
    );

    await waitFor(() => {
      expect(providerSelect).toBeEnabled();
    });

    await userEvent.selectOptions(providerSelect, "litellm");

    const submitButton = screen.getByRole("button", { name: "Ajouter le modèle" });
    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith("test-token", {
        name: "gpt-4o-mini",
        display_name: null,
        description: null,
        supports_reasoning: false,
        provider_id: "primary",
        provider_slug: "litellm",
      });
    });
  });
});
