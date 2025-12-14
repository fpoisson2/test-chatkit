import { render, screen, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { useScrollToBottom } from "../useScrollToBottom";

function TestComponent({
  itemCount,
  threadId,
}: {
  itemCount: number;
  threadId?: string;
}): JSX.Element {
  const { messagesContainerRef, messagesEndRef } = useScrollToBottom(
    itemCount,
    {},
    threadId,
  );

  return (
    <div>
      <div ref={messagesContainerRef} data-testid="messages-container">
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

describe("useScrollToBottom", () => {
  beforeEach(() => {
    window.requestAnimationFrame = (cb) => {
      cb(0);
      return 0;
    };

    Object.defineProperty(Element.prototype, "scrollTo", {
      writable: true,
      value: function scrollTo(this: Element, options: ScrollToOptions) {
        const top = typeof options === "object" ? options.top : undefined;
        if (typeof top === "number") {
          // @ts-expect-error scrollTop exists on HTMLElement in the app
          this.scrollTop = top;
        }
      },
    });
  });

  it("ne force pas le scroll vers le bas quand l'utilisateur est remonté", () => {
    const { rerender } = render(
      <TestComponent itemCount={1} threadId="thread-1" />,
    );

    const container = screen.getByTestId("messages-container") as HTMLDivElement;
    Object.defineProperty(container, "scrollHeight", { value: 1000, writable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, writable: true });
    container.scrollTop = 100;

    const scrollTo = vi.fn();
    container.scrollTo = scrollTo as unknown as typeof container.scrollTo;

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    rerender(<TestComponent itemCount={2} threadId="thread-1" />);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(100);
  });

  it("fait défiler jusqu'en bas lorsque l'utilisateur est déjà en bas", () => {
    const { rerender } = render(
      <TestComponent itemCount={1} threadId="thread-1" />,
    );

    const container = screen.getByTestId("messages-container") as HTMLDivElement;
    Object.defineProperty(container, "scrollHeight", { value: 1000, writable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, writable: true });
    container.scrollTop = 600;

    const scrollTo = vi.fn((options: ScrollToOptions) => {
      container.scrollTop = options.top ?? container.scrollTop;
    });
    container.scrollTo = scrollTo as unknown as typeof container.scrollTo;

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    rerender(<TestComponent itemCount={2} threadId="thread-1" />);

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: "smooth",
      top: 1000,
    });
    expect(container.scrollTop).toBe(1000);
  });
});
