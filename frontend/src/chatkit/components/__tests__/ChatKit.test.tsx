import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatKit } from "../ChatKit";
import type { ChatKitControl, ChatKitOptions } from "../../types";
import { I18nProvider } from "../../../i18n/I18nProvider";

const baseModels = [
  { id: "gpt-5", label: "gpt-5", description: "Balanced intelligence", default: true },
  { id: "gpt-4", label: "gpt-4", description: "Precise reasoning" },
];

const createControl = (sendMessage = vi.fn()) =>
  ({
    thread: { id: "thread-1", items: [], status: null },
    isLoading: false,
    error: null,
    loadingThreadIds: new Set<string>(),
    sendMessage,
    refresh: vi.fn().mockResolvedValue(undefined),
    customAction: vi.fn().mockResolvedValue(undefined),
    retryAfterItem: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    updateThreadMetadata: vi.fn().mockResolvedValue(undefined),
  }) satisfies ChatKitControl;

const options: ChatKitOptions = {
  header: false,
  history: { enabled: false },
  api: { url: "https://example.test", headers: {} },
  composer: {
    placeholder: "Ask a question...",
    attachments: { enabled: false },
    models: baseModels,
  },
};

const renderChatKit = (control: ChatKitControl) =>
  render(
    <I18nProvider>
      <ChatKit control={control} options={options} />
    </I18nProvider>,
  );

describe("ChatKit model selector", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ languages: [] }),
    } as Response);

    if (!("scrollIntoView" in Element.prototype)) {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        value: vi.fn(),
        writable: true,
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("affiche le modèle par défaut et la description associée", () => {
    const control = createControl();

    renderChatKit(control);

    const select = screen.getByLabelText(/sélectionner un modèle/i) as HTMLSelectElement;
    expect(select.value).toBe("gpt-5");
    expect(screen.getByText("Balanced intelligence")).toBeInTheDocument();
  });

  it("passe le modèle choisi dans les inferenceOptions lors de l'envoi", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const control = createControl(sendMessage);

    renderChatKit(control);

    const user = userEvent.setup();

    const select = screen.getByLabelText(/sélectionner un modèle/i);
    await user.selectOptions(select, "gpt-4");

    const textarea = screen.getByPlaceholderText("Ask a question...");
    await user.type(textarea, "Bonjour");

    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      [{ type: "input_text", text: "Bonjour" }],
      { inferenceOptions: { model: "gpt-4" } },
    );
  });
});
