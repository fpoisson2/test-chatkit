import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeAll, expect } from "vitest";

expect.extend(matchers);

type PolyfilledScope = typeof globalThis & {
  DOMMatrixReadOnly?: typeof DOMMatrixReadOnly;
  ResizeObserver?: typeof ResizeObserver;
  matchMedia?: typeof matchMedia;
};

const defineIfMissing = <K extends keyof PolyfilledScope>(
  scope: PolyfilledScope,
  key: K,
  factory: () => NonNullable<PolyfilledScope[K]>,
) => {
  if (!(key in scope) || typeof scope[key] === "undefined") {
    const value = factory();
    Object.defineProperty(scope, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
};

const installPolyfills = (scope: PolyfilledScope) => {
  defineIfMissing(scope, "ResizeObserver", () => {
    class ResizeObserverMock implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(): void {}

      unobserve(): void {}

      disconnect(): void {}
    }

    return ResizeObserverMock;
  });

  defineIfMissing(scope, "DOMMatrixReadOnly", () => {
    class DOMMatrixReadOnlyMock implements DOMMatrixReadOnly {
      readonly is2D = true;
      readonly isIdentity = true;
      readonly a = 1;
      readonly b = 0;
      readonly c = 0;
      readonly d = 1;
      readonly e = 0;
      readonly f = 0;
      readonly m11 = 1;
      readonly m12 = 0;
      readonly m13 = 0;
      readonly m14 = 0;
      readonly m21 = 0;
      readonly m22 = 1;
      readonly m23 = 0;
      readonly m24 = 0;
      readonly m31 = 0;
      readonly m32 = 0;
      readonly m33 = 1;
      readonly m34 = 0;
      readonly m41 = 0;
      readonly m42 = 0;
      readonly m43 = 0;
      readonly m44 = 1;

      constructor(_: DOMMatrixInit | string = "") {}

      flipX(): DOMMatrixReadOnly {
        return this;
      }

      flipY(): DOMMatrixReadOnly {
        return this;
      }

      inverse(): DOMMatrixReadOnly {
        return this;
      }

      multiply(_: DOMMatrixInit | DOMMatrixReadOnly): DOMMatrixReadOnly {
        return this;
      }

      rotate(_: number, __?: number, ___?: number): DOMMatrixReadOnly {
        return this;
      }

      rotateAxisAngle(_: number, __: number, ___: number, ____: number): DOMMatrixReadOnly {
        return this;
      }

      rotateFromVector(_: number, __: number): DOMMatrixReadOnly {
        return this;
      }

      scale(_: number, __?: number, ___?: number, ____?: number, _____?: number, ______?: number): DOMMatrixReadOnly {
        return this;
      }

      scale3d(_: number, __?: number, ___?: number, ____?: number): DOMMatrixReadOnly {
        return this;
      }

      scaleNonUniform(_: number, __?: number): DOMMatrixReadOnly {
        return this;
      }

      skewX(_: number): DOMMatrixReadOnly {
        return this;
      }

      skewY(_: number): DOMMatrixReadOnly {
        return this;
      }

      toFloat32Array(): Float32Array {
        return new Float32Array();
      }

      toFloat64Array(): Float64Array {
        return new Float64Array();
      }

      toJSON(): unknown {
        return {};
      }

      translate(_: number, __?: number, ___?: number): DOMMatrixReadOnly {
        return this;
      }
    }

    return DOMMatrixReadOnlyMock;
  });

  defineIfMissing(scope, "matchMedia", () => {
    const stub: typeof matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });

    return stub;
  });
};

installPolyfills(globalThis as PolyfilledScope);

beforeAll(() => {
  if (typeof window !== "undefined") {
    installPolyfills(window as PolyfilledScope);
  }
});

afterEach(() => {
  installPolyfills(globalThis as PolyfilledScope);
  if (typeof window !== "undefined") {
    installPolyfills(window as PolyfilledScope);
  }
});
