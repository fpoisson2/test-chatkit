import { act, renderHook } from "@testing-library/react";

import { useChatkitSession } from "../useChatkitSession";
import * as backendApi from "../../utils/backend";
import { ApiError } from "../../utils/backend";

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

const fetchChatkitSessionSpy = vi.spyOn(backendApi, "fetchChatkitSession");

const setupHook = (overrides: Partial<Parameters<typeof useChatkitSession>[0]> = {}) => {
  const disableHostedFlow = vi.fn();
  const hook = renderHook(() =>
    useChatkitSession({
      sessionOwner: "user@example.com",
      storageKey: "user@example.com:hosted",
      token: null,
      mode: "hosted",
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
    fetchChatkitSessionSpy.mockReset();
  });

  afterAll(() => {
    fetchChatkitSessionSpy.mockRestore();
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
    expect(fetchChatkitSessionSpy).not.toHaveBeenCalled();
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

    fetchChatkitSessionSpy.mockResolvedValue({
      client_secret: "fresh-secret",
      expires_at: "2024-01-01T00:00:00Z",
    });

    const { result } = setupHook();

    let secret: string | null = null;
    await act(async () => {
      secret = await result.current.getClientSecret(null);
    });

    expect(secret).toBe("fresh-secret");
    expect(fetchChatkitSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user: "user@example.com", token: null }),
    );
    expect(mockNormalizeSessionExpiration).toHaveBeenCalledWith("2024-01-01T00:00:00Z");
    expect(mockPersistChatKitSecret).toHaveBeenCalledWith(
      "user@example.com:hosted",
      "fresh-secret",
      1_704_067_200_000,
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("désactive le flux hébergé lorsque CHATKIT_WORKFLOW_ID est manquant", async () => {
    mockReadStoredChatKitSession.mockReturnValue({ session: null, shouldRefresh: false });

    fetchChatkitSessionSpy.mockRejectedValue(
      new ApiError("CHATKIT_WORKFLOW_ID missing", {
        status: 500,
        detail: { detail: { error: "CHATKIT_WORKFLOW_ID missing" } },
      }),
    );

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
    expect(mockClearStoredChatKitSecret).toHaveBeenCalledWith("user@example.com:hosted");
    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toContain("Le flux hébergé a été désactivé");
    expect(result.current.error).toContain("Le flux hébergé a été désactivé");
  });

  it("rejette lorsqu'un client_secret est demandé en mode local", async () => {
    const { result } = setupHook({ mode: "local" });

    await expect(result.current.getClientSecret(null)).rejects.toThrow(
      /client secret unavailable/i,
    );
    expect(fetchChatkitSessionSpy).not.toHaveBeenCalled();
  });
});
