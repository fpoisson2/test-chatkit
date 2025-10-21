import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverMock implements ResizeObserver {
    callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    disconnect(): void {}

    observe(): void {}

    unobserve(): void {}
  }

  // @ts-expect-error - test environment polyfill
  window.ResizeObserver = ResizeObserverMock;
  // @ts-expect-error - vitest environment polyfill
  global.ResizeObserver = ResizeObserverMock;
}

if (typeof window !== "undefined" && !("DOMMatrixReadOnly" in window)) {
  class DOMMatrixReadOnlyMock {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(_: DOMMatrixInit | string = "") {}
  }

  // @ts-expect-error - test environment polyfill
  window.DOMMatrixReadOnly = DOMMatrixReadOnlyMock;
  // @ts-expect-error - vitest environment polyfill
  global.DOMMatrixReadOnly = DOMMatrixReadOnlyMock;
}
