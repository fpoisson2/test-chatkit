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
  model_provider: "litellm",
  model_api_base: "http://localhost:4000",
  is_model_provider_overridden: true,
  is_model_api_base_overridden: true,
  is_model_api_key_managed: true,
  model_api_key_hint: "••••3456",
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
      model_provider: "litellm",
      model_api_base: "http://localhost:4000",
      is_model_provider_overridden: true,
      is_model_api_base_overridden: true,
      is_model_api_key_managed: true,
      model_api_key_hint: "••••cret",
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

    const providerSelect = screen.getByLabelText(
      "admin.appSettings.model.providerLabel",
    ) as HTMLSelectElement;
    await userEvent.selectOptions(providerSelect, "litellm");

    const apiBaseInput = screen.getByLabelText(
      "admin.appSettings.model.apiBaseLabel",
    );
    await waitFor(() => {
      expect(apiBaseInput).not.toHaveAttribute("disabled");
    });
    await userEvent.clear(apiBaseInput);
    await userEvent.type(apiBaseInput, "http://localhost:4000/");

    const apiKeyInput = screen.getByLabelText(
      "admin.appSettings.model.apiKeyLabel",
    );
    await userEvent.type(apiKeyInput, "proxy-secret");

    const promptInput = screen.getByLabelText(
      "admin.appSettings.threadTitle.fieldLabel",
    );
    fireEvent.change(promptInput, { target: { value: "Nouveau prompt" } });
    expect(promptInput).toHaveValue("Nouveau prompt");

    const submitButton = screen.getByRole("button", {
      name: "admin.appSettings.actions.save",
    });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith("test-token", {
        thread_title_prompt: "Nouveau prompt",
        model_provider: "litellm",
        model_api_base: "http://localhost:4000",
        model_api_key: "proxy-secret",
        sip_trunk_uri: null,
        sip_trunk_username: null,
        sip_trunk_password: null,
        sip_contact_host: null,
        sip_contact_port: null,
        sip_contact_transport: null,
      });
    });
  });
});
