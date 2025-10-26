import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { AdminAppSettingsPage } from "../AdminAppSettingsPage";

const { getMock, updateMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  updateMock: vi.fn(),
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
  appSettingsApi: {
    get: getMock,
    update: updateMock,
  },
  isUnauthorizedError: () => false,
}));

const baseSettings = {
  thread_title_prompt: "Prompt par défaut",
  default_thread_title_prompt: "Prompt par défaut",
  is_custom_thread_title_prompt: false,
  thread_title_model: "gpt-4o-mini",
  default_thread_title_model: "gpt-4o-mini",
  is_custom_thread_title_model: false,
  model_provider: "litellm",
  model_api_base: "http://localhost:4000",
  is_model_provider_overridden: true,
  is_model_api_base_overridden: true,
  is_model_api_key_managed: true,
  model_api_key_hint: "••••3456",
  model_providers: [
    {
      id: "primary",
      provider: "litellm",
      api_base: "http://localhost:4000",
      has_api_key: true,
      api_key_hint: "••••3456",
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

describe("AdminAppSettingsPage", () => {
  beforeEach(() => {
    getMock.mockResolvedValue({ ...baseSettings });
    updateMock.mockResolvedValue({
      ...baseSettings,
      thread_title_model: "gpt-5o-mini",
      is_custom_thread_title_model: true,
      model_provider: "gemini",
      model_api_base: "https://generativelanguage.googleapis.com",
      is_model_provider_overridden: true,
      is_model_api_base_overridden: true,
      is_model_api_key_managed: true,
      model_api_key_hint: "••••cret",
      model_providers: [
        {
          id: "primary",
          provider: "litellm",
          api_base: "http://localhost:4000",
          has_api_key: true,
          api_key_hint: "••••cret",
          is_default: false,
        },
        {
          id: "generated-id",
          provider: "gemini",
          api_base: "https://generativelanguage.googleapis.com",
          has_api_key: true,
          api_key_hint: "••••cret",
          is_default: true,
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("submits custom model configuration", async () => {
    render(<AdminAppSettingsPage />);

    await screen.findByLabelText("admin.appSettings.threadTitle.fieldLabel");
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("test-token");
    });

    const providerInputs = screen.getAllByLabelText(
      "admin.appSettings.model.providerNameLabel",
    );
    await userEvent.clear(providerInputs[0]);
    await userEvent.type(providerInputs[0], "litellm");

    const apiBaseInputs = screen.getAllByLabelText(
      "admin.appSettings.model.apiBaseLabel",
    );
    await waitFor(() => {
      expect(apiBaseInputs[0]).not.toHaveAttribute("disabled");
    });
    await userEvent.clear(apiBaseInputs[0]);
    await userEvent.type(apiBaseInputs[0], "http://localhost:4000/");

    const apiKeyInputs = screen.getAllByLabelText(
      "admin.appSettings.model.apiKeyLabel",
    );
    await userEvent.type(apiKeyInputs[0], "proxy-secret");

    const addButton = screen.getByRole("button", {
      name: "admin.appSettings.model.addProvider",
    });
    await userEvent.click(addButton);

    const updatedProviderInputs = screen.getAllByLabelText(
      "admin.appSettings.model.providerNameLabel",
    );
    await userEvent.type(updatedProviderInputs[1], "gemini");

    const updatedApiBaseInputs = screen.getAllByLabelText(
      "admin.appSettings.model.apiBaseLabel",
    );
    await userEvent.type(
      updatedApiBaseInputs[1],
      "https://generativelanguage.googleapis.com/",
    );

    const updatedApiKeyInputs = screen.getAllByLabelText(
      "admin.appSettings.model.apiKeyLabel",
    );
    await userEvent.type(updatedApiKeyInputs[1], "gemini-secret");

    const defaultRadios = screen.getAllByLabelText(
      "admin.appSettings.model.defaultProviderLabel",
    );
    await userEvent.click(defaultRadios[1]);

    const promptInput = screen.getByLabelText(
      "admin.appSettings.threadTitle.fieldLabel",
    );
    fireEvent.change(promptInput, { target: { value: "Nouveau prompt" } });
    expect(promptInput).toHaveValue("Nouveau prompt");

    const modelInput = screen.getByLabelText(
      "admin.appSettings.threadTitle.modelLabel",
    );
    await userEvent.clear(modelInput);
    await userEvent.type(modelInput, "gpt-5o-mini");

    const submitButton = screen.getByRole("button", {
      name: "admin.appSettings.actions.save",
    });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith("test-token", {
        thread_title_prompt: "Nouveau prompt",
        thread_title_model: "gpt-5o-mini",
        sip_trunk_uri: null,
        sip_trunk_username: null,
        sip_trunk_password: null,
        sip_contact_host: null,
        sip_contact_port: null,
        sip_contact_transport: null,
        model_providers: [
          {
            id: "primary",
            provider: "litellm",
            api_base: "http://localhost:4000",
            api_key: "proxy-secret",
            is_default: false,
          },
          {
            provider: "gemini",
            api_base: "https://generativelanguage.googleapis.com",
            api_key: "gemini-secret",
            is_default: true,
          },
        ],
      });
    });
  });
});
