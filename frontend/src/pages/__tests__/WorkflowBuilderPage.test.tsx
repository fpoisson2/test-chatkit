import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { WorkflowBuilderPage } from "../WorkflowBuilderPage";

const logoutMock = vi.hoisted(() => vi.fn());

vi.mock("../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { is_admin: true },
    logout: logoutMock,
  }),
}));

const makeApiEndpointCandidatesMock = vi.hoisted(() =>
  vi.fn<[string, string], string[]>(() => ["/api/workflows/current"]),
);

vi.mock("../../utils/backend", () => ({
  makeApiEndpointCandidates: makeApiEndpointCandidatesMock,
}));

describe("WorkflowBuilderPage", () => {
  const defaultResponse = {
    id: 1,
    name: "workflow",
    is_active: true,
    steps: [
      { agent_key: "triage", position: 1, is_enabled: true, parameters: {} },
      { agent_key: "get_data_from_web", position: 2, is_enabled: true, parameters: {} },
      { agent_key: "r_dacteur", position: 3, is_enabled: true, parameters: {} },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("affiche les étapes et enregistre les modifications", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => defaultResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...defaultResponse,
          steps: [
            { agent_key: "get_data_from_web", position: 1, is_enabled: true, parameters: {} },
            { agent_key: "triage", position: 2, is_enabled: true, parameters: { model: "gpt-4" } },
            { agent_key: "r_dacteur", position: 3, is_enabled: true, parameters: {} },
          ],
        }),
      } as Response);

    render(<WorkflowBuilderPage />);

    await screen.findByText(/triage/i);

    const articles = screen.getAllByRole("article");
    expect(articles[0].textContent).toContain("triage");

    const moveUpButtons = screen.getAllByRole("button", { name: "Monter" });
    fireEvent.click(moveUpButtons[1]);

    await waitFor(() => {
      const reordered = screen.getAllByRole("article");
      expect(reordered[0].textContent).toContain("get_data_from_web");
    });

    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[1], { target: { value: '{"model":"gpt-4"}' } });

    const saveButton = screen.getByRole("button", { name: /enregistrer les modifications/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const putCall = fetchMock.mock.calls[1];
    expect(putCall?.[0]).toBe("/api/workflows/current");
    expect(putCall?.[1]).toMatchObject({ method: "PUT" });
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    expect(body.steps[0].agent_key).toBe("get_data_from_web");
    expect(body.steps[1].parameters).toEqual({ model: "gpt-4" });

    await screen.findByText(/Configuration enregistrée avec succès/i);
  });
});
