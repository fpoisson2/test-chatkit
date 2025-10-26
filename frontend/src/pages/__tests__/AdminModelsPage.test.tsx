import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminModelsPage } from "../AdminModelsPage";

import "@testing-library/jest-dom/vitest";

const {
  listAdminMock,
  createMock,
  updateMock,
  deleteMock,
  getSettingsMock,
  logoutMock,
} = vi.hoisted(() => ({
  listAdminMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  getSettingsMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock("../../auth", () => ({
  useAuth: () => ({ token: "test-token", logout: logoutMock }),
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
const tMock = (key: string, params?: Record<string, string>) =>
  translate(key, params);

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: tMock,
  }),
}));

vi.mock("../../utils/backend", () => ({
  modelRegistryApi: {
    listAdmin: listAdminMock,
    create: createMock,
    update: updateMock,
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
  thread_title_model: "gpt-4o-mini",
  default_thread_title_model: "gpt-4o-mini",
  is_custom_thread_title_model: false,
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
      supports_previous_response_id: true,
      supports_reasoning_summary: true,
      store: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });
    updateMock.mockResolvedValue({
      id: 42,
      name: "gpt-4o-mini",
      display_name: "",
      description: null,
      provider_id: "primary",
      provider_slug: "litellm",
      supports_reasoning: false,
      supports_previous_response_id: true,
      supports_reasoning_summary: true,
      store: false,
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

    const [providerSelect] = await screen.findAllByLabelText(
      "admin.models.form.providerSelectLabel",
    );

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledWith("test-token");
    });

    const openAiOption = (
      await screen.findAllByRole("option", {
        name: "admin.models.form.providerOptionOpenAI",
      })
    )[0];
    expect(openAiOption).toHaveValue("openai");

    const defaultOption = screen.getAllByRole("option", {
      name: "admin.models.form.providerOptionWithDefault",
    })[0];
    expect(defaultOption).toHaveValue("litellm");
  });

  it("submits the selected provider slug and identifier", async () => {
    render(<AdminModelsPage />);

    const [nameInput] = await screen.findAllByLabelText(
      "admin.models.form.modelIdLabel",
    );

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "gpt-4o-mini");

    const [providerSelect] = await screen.findAllByLabelText(
      "admin.models.form.providerSelectLabel",
    );

    await userEvent.selectOptions(providerSelect, "litellm");

    const submitButton = screen.getAllByRole("button", {
      name: "admin.models.form.submitCreate",
    })[0];
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
        supports_previous_response_id: true,
        supports_reasoning_summary: true,
        provider_id: "primary",
        provider_slug: "litellm",
        store: false,
      });
    });
  });

  it("allows editing an existing model", async () => {
    const existingModel = {
      id: 7,
      name: "gpt-4o-mini",
      display_name: "GPT-4o Mini",
      description: "Test model",
      provider_id: "primary",
      provider_slug: "litellm",
      supports_reasoning: false,
      supports_previous_response_id: true,
      supports_reasoning_summary: true,
      store: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    listAdminMock.mockResolvedValue([existingModel]);
    updateMock.mockResolvedValue({
      ...existingModel,
      supports_previous_response_id: false,
      updated_at: "2024-01-02T00:00:00Z",
    });

    render(<AdminModelsPage />);

    const editButton = (
      await screen.findAllByRole("button", {
        name: "admin.models.table.editAction",
      })
    )[0];
    await userEvent.click(editButton);

    const submitButton = screen.getAllByRole("button", {
      name: "admin.models.form.submitUpdate",
    })[0];

    const incrementalCheckbox = screen.getAllByLabelText(
      "admin.models.form.supportsPreviousResponseId",
    )[0];
    expect(incrementalCheckbox).toBeChecked();
    await userEvent.click(incrementalCheckbox);

    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        "test-token",
        expect.any(Number),
        expect.objectContaining({
          name: existingModel.name,
          provider_id: existingModel.provider_id,
          provider_slug: existingModel.provider_slug,
          supports_previous_response_id: false,
          store: false,
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "admin.models.form.submitCreate",
        })[0],
      ).toBeEnabled();
    });
    await screen.findByText("admin.models.feedback.updated");
  });
});
