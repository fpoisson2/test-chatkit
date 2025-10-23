import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VectorStoreTable } from "../VectorStoreTable";
import {
  WORKFLOW_VECTOR_STORE_SLUG,
  type VectorStoreSummary,
} from "../../utils/backend";

const baseStore: VectorStoreSummary = {
  slug: "demo-store",
  title: "Demo store",
  description: null,
  metadata: {},
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  documents_count: 0,
};

describe("VectorStoreTable", () => {
  it("cache le bouton de suppression pour le vector store protégé", () => {
    const stores: VectorStoreSummary[] = [
      {
        ...baseStore,
        slug: WORKFLOW_VECTOR_STORE_SLUG,
        title: "Workflows",
      },
      {
        ...baseStore,
        slug: "public-store",
        title: "Public",
      },
    ];

    render(
      <VectorStoreTable
        stores={stores}
        isLoading={false}
        onIngest={vi.fn()}
        onSearch={vi.fn()}
        onDocuments={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const deleteButtons = screen.getAllByRole("button", { name: "Supprimer" });
    expect(deleteButtons).toHaveLength(2);

    const protectedRow = screen.getAllByText(WORKFLOW_VECTOR_STORE_SLUG)
      .map((element) => element.closest("tr"))
      .find((element): element is HTMLTableRowElement => element !== null);
    expect(protectedRow).not.toBeUndefined();
    if (protectedRow) {
      expect(
        within(protectedRow).queryByRole("button", { name: "Supprimer" }),
      ).toBeNull();
    }

    const cards = screen.getAllByRole("article");
    const protectedCard = cards.find((card) =>
      within(card).queryByText(WORKFLOW_VECTOR_STORE_SLUG),
    );
    expect(protectedCard).toBeDefined();
    if (protectedCard) {
      expect(
        within(protectedCard).queryByRole("button", { name: "Supprimer" }),
      ).toBeNull();
    }
  });
});

