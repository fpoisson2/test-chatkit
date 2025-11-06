import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRef } from "react";

import { useOutsidePointerDown } from "./useOutsidePointerDown";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useOutsidePointerDown", () => {
  it("invokes the handler when clicking outside of the provided elements", () => {
    const trigger = document.createElement("button");
    const menu = document.createElement("div");
    const outside = document.createElement("div");

    document.body.append(trigger, menu, outside);

    const handler = vi.fn();

    renderHook(() => {
      const triggerRef = useRef<HTMLButtonElement | null>(trigger);
      const menuRef = useRef<HTMLDivElement | null>(menu);
      useOutsidePointerDown([triggerRef, menuRef], handler, { enabled: true });
    });

    act(() => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the handler when clicking inside the provided elements", () => {
    const trigger = document.createElement("button");
    const menu = document.createElement("div");

    document.body.append(trigger, menu);

    const handler = vi.fn();

    renderHook(() => {
      const triggerRef = useRef<HTMLButtonElement | null>(trigger);
      const menuRef = useRef<HTMLDivElement | null>(menu);
      useOutsidePointerDown([triggerRef, menuRef], handler, { enabled: true });
    });

    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      menu.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports disabling the listener", () => {
    const trigger = document.createElement("button");
    const menu = document.createElement("div");
    const outside = document.createElement("div");

    document.body.append(trigger, menu, outside);

    const handler = vi.fn();

    const { rerender } = renderHook(({ enabled }: { enabled: boolean }) => {
      const triggerRef = useRef<HTMLButtonElement | null>(trigger);
      const menuRef = useRef<HTMLDivElement | null>(menu);
      useOutsidePointerDown([triggerRef, menuRef], handler, { enabled });
    }, { initialProps: { enabled: false } });

    act(() => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(handler).not.toHaveBeenCalled();

    rerender({ enabled: true });

    act(() => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
