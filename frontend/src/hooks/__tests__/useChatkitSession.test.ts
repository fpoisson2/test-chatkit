import { act, renderHook } from "@testing-library/react";

import { useChatkitSession } from "../useChatkitSession";

declare global {
  // eslint-disable-next-line no-var
  var fetch: ReturnType<typeof vi.fn> | undefined;
}

const originalFetch = global.fetch;

const {
  mockReadStoredChatKitSession,
  mockPersistChatKitSecret,
  mockClearStoredChatKitSecret,
  mockNormalizeSessionExpiration,
} = vi.hoisted(() => ({
  mockReadStoredChatKitSession: vi.fn(),
  mockPersistChatKitSecret: vi.fn(),
  mockClearStoredChatKitSecret: vi.fn(),
  mockNormalizeSessionExpiration: vi.fn(),
}));

vi.mock("../../utils/chatkitSession", () => ({
  readStoredChatKitSession: mockReadStoredChatKitSession,
  persistChatKitSecret: mockPersistChatKitSecret,
  clearStoredChatKitSecret: mockClearStoredChatKitSecret,
  normalizeSessionExpiration: mockNormalizeSessionExpiration,
}));

const setupHook = (overrides: Partial<Parameters<typeof useChatkitSession>[0]> = {}) => {
  const disableHostedFlow = vi.fn();
  const hook = renderHook(() =>
    useChatkitSession({
      sessionOwner: "user@example.com",
      token: null,
      hostedFlowEnabled: true,
      disableHostedFlow,
      ...overrides,
    }),
  );

  return { ...hook, disableHostedFlow };
};

describe("useChatkitSession", () => {
  beforeEach(() => {
    mockReadStoredChatKitSession.mockReset();
    mockPersistChatKitSecret.mockReset();
    mockClearStoredChatKitSecret.mockReset();
    mockNormalizeSessionExpiration.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("retourne le secret stocké lorsqu'il est valide", async () => {
    mockReadStoredChatKitSession.mockReturnValue({
      session: { secret: "stored-secret" },
      shouldRefresh: false,
    });

    const { result } = setupHook();

    let secret: string | null = null;
    await act(async () => {
      secret = await result.current.getClientSecret(null);
    });

    expect(secret).toBe("stored-secret");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPersistChatKitSecret).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    act(() => {
      result.current.reportError("Erreur personnalisée");
    });
    expect(result.current.error).toBe("Erreur personnalisée");

    act(() => {
      result.current.resetError();
    });
    expect(result.current.error).toBeNull();
  });

  it("récupère un nouveau client_secret et le persiste", async () => {
    mockReadStoredChatKitSession.mockReturnValue({ session: null, shouldRefresh: false });
    mockNormalizeSessionExpiration.mockReturnValue(1_704_067_200_000);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ client_secret: "fresh-secret", expires_at: "2024-01-01T00:00:00Z" }),
    });

    const { result } = setupHook();

    let secret: string | null = null;
    await act(async () => {
      secret = await result.current.getClientSecret(null);
    });

    expect(secret).toBe("fresh-secret");
    expect(global.fetch).toHaveBeenCalledWith("/api/chatkit/session", expect.any(Object));
    expect(mockNormalizeSessionExpiration).toHaveBeenCalledWith("2024-01-01T00:00:00Z");
    expect(mockPersistChatKitSecret).toHaveBeenCalledWith(
      "user@example.com",
      "fresh-secret",
      1_704_067_200_000,
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("désactive le flux hébergé lorsque CHATKIT_WORKFLOW_ID est manquant", async () => {
    mockReadStoredChatKitSession.mockReturnValue({ session: null, shouldRefresh: false });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ detail: { error: "CHATKIT_WORKFLOW_ID missing" } }),
    });

    const { result, disableHostedFlow } = setupHook();

    let thrownError: unknown;
    await act(async () => {
      try {
        await result.current.getClientSecret(null);
      } catch (error) {
        thrownError = error;
      }
    });

    expect(disableHostedFlow).toHaveBeenCalledWith("CHATKIT_WORKFLOW_ID manquant");
    expect(mockClearStoredChatKitSecret).toHaveBeenCalledWith("user@example.com");
    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toContain("Le flux hébergé a été désactivé");
    expect(result.current.error).toContain("Le flux hébergé a été désactivé");
  });
});
