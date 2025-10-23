import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { VectorStoreIngestionForm } from "../VectorStoreIngestionForm";

describe("VectorStoreIngestionForm", () => {
  it("submits a workflow blueprint when the option is selected", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <VectorStoreIngestionForm onSubmit={onSubmit} onCancel={onCancel} />
      </I18nProvider>,
    );

    await user.clear(screen.getByLabelText("Identifiant du document"));
    await user.type(screen.getByLabelText("Identifiant du document"), "guide-paris");

    const documentTextarea = screen.getByLabelText("Document JSON");
    await user.clear(documentTextarea);
    fireEvent.change(documentTextarea, { target: { value: '{"title":"Paris"}' } });

    const metadataTextarea = screen.getByLabelText("Métadonnées du document (JSON)");
    await user.clear(metadataTextarea);
    fireEvent.change(metadataTextarea, { target: { value: '{"language":"fr"}' } });

    await user.click(screen.getByRole("checkbox", { name: "Create a workflow" }));

    await user.type(screen.getByLabelText("Workflow slug"), "Vector-Flow");
    await user.type(screen.getByLabelText("Workflow name"), "Vector Flow");
    await user.type(
      screen.getByLabelText("Workflow description (optional)"),
      "Workflow imported from test",
    );

    const graphTextarea = screen.getByLabelText("Workflow graph (JSON)");
    await user.clear(graphTextarea);
    fireEvent.change(graphTextarea, {
      target: { value: '{"nodes": [], "edges": []}' },
    });

    await user.click(screen.getByRole("button", { name: "Ingestion" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [payload] = onSubmit.mock.calls[0];
    expect(payload).toStrictEqual({
      doc_id: "guide-paris",
      document: { title: "Paris" },
      metadata: { language: "fr" },
      store_title: undefined,
      store_metadata: undefined,
      workflow_blueprint: {
        slug: "vector-flow",
        display_name: "Vector Flow",
        description: "Workflow imported from test",
        graph: { nodes: [], edges: [] },
        mark_active: true,
      },
    });
  });
});

