import { act, renderHook } from "@testing-library/react";

import { useHostedFlow } from "../useHostedFlow";

describe("useHostedFlow", () => {
  const originalEnv = { ...import.meta.env };

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv);
  });

  it("active le flux hébergé lorsque la variable d'environnement est vraie", () => {
    Object.assign(import.meta.env, { VITE_CHATKIT_FORCE_HOSTED: "true" });

    const { result } = renderHook(() => useHostedFlow());

    expect(result.current.hostedFlowEnabled).toBe(true);
  });

  it("désactive le flux hébergé et invoque le rappel", () => {
    Object.assign(import.meta.env, { VITE_CHATKIT_FORCE_HOSTED: "false" });
    const onDisable = vi.fn();

    const { result } = renderHook(() => useHostedFlow({ onDisable }));

    expect(result.current.hostedFlowEnabled).toBe(false);

    act(() => {
      result.current.enableHostedFlow();
    });
    expect(result.current.hostedFlowEnabled).toBe(true);

    act(() => {
      result.current.disableHostedFlow("test");
    });

    expect(result.current.hostedFlowEnabled).toBe(false);
    expect(onDisable).toHaveBeenCalledTimes(1);
  });
});
