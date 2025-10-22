import { act, renderHook, waitFor } from "@testing-library/react";

import { useChatkitWorkflowSync } from "../useChatkitWorkflowSync";

const { getWorkflowMock } = vi.hoisted(() => ({
  getWorkflowMock: vi.fn(),
}));

vi.mock("../../utils/backend", () => ({
  chatkitApi: { getWorkflow: getWorkflowMock },
}));

const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;

describe("useChatkitWorkflowSync", () => {
  beforeAll(() => {
    global.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 0;
    };
    global.cancelAnimationFrame = () => {};
  });

  afterAll(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  beforeEach(() => {
    getWorkflowMock.mockReset();
  });

  it("charge le workflow lorsque le token est défini", async () => {
    const workflow = { auto_start: false };
    getWorkflowMock.mockResolvedValue(workflow);

    const fetchUpdates = vi.fn().mockResolvedValue(undefined);
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    const reportError = vi.fn();

    const { result } = renderHook(() =>
      useChatkitWorkflowSync({
        token: "token",
        activeWorkflow: null,
        fetchUpdates,
        sendUserMessage,
        initialThreadId: "thread-1",
        reportError,
      }),
    );

    await waitFor(() => {
      expect(getWorkflowMock).toHaveBeenCalledWith("token");
      expect(result.current.chatkitWorkflowInfo).toEqual(workflow);
    });
  });

  it("démarre automatiquement le workflow lorsque c'est possible", async () => {
    getWorkflowMock.mockResolvedValue({ auto_start: true, auto_start_user_message: "" });

    const fetchUpdates = vi.fn().mockResolvedValue(undefined);
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    const reportError = vi.fn();

    renderHook(() =>
      useChatkitWorkflowSync({
        token: "token",
        activeWorkflow: null,
        fetchUpdates,
        sendUserMessage,
        initialThreadId: null,
        reportError,
      }),
    );

    await waitFor(() => {
      expect(sendUserMessage).toHaveBeenCalledWith({ text: "\u200B", newThread: true });
    });

    await waitFor(() => {
      expect(fetchUpdates).toHaveBeenCalled();
    });

    expect(reportError).not.toHaveBeenCalled();
  });

  it("n'envoie pas de démarrage automatique lorsqu'un fil est stocké", async () => {
    getWorkflowMock.mockResolvedValue({ auto_start: true, auto_start_user_message: "" });

    const fetchUpdates = vi.fn().mockResolvedValue(undefined);
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    const reportError = vi.fn();

    renderHook(() =>
      useChatkitWorkflowSync({
        token: "token",
        activeWorkflow: null,
        fetchUpdates,
        sendUserMessage,
        initialThreadId: "thread-existant",
        reportError,
      }),
    );

    await waitFor(() => {
      expect(getWorkflowMock).toHaveBeenCalled();
    });

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("expose une fonction de rafraîchissement réutilisable", async () => {
    getWorkflowMock.mockResolvedValue({ auto_start: false });

    const fetchUpdates = vi.fn().mockResolvedValue(undefined);
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    const reportError = vi.fn();

    const { result } = renderHook(() =>
      useChatkitWorkflowSync({
        token: "token",
        activeWorkflow: null,
        fetchUpdates,
        sendUserMessage,
        initialThreadId: "thread-2",
        reportError,
      }),
    );

    await waitFor(() => {
      expect(getWorkflowMock).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.requestRefresh("test");
    });

    expect(fetchUpdates).toHaveBeenCalled();
  });
});
