process.env.NODE_ENV = 'test';

// Only relevant to jsdom-environment test files (e.g. accessibility.test.tsx);
// a no-op import under the default node environment used by server tests.
import '@testing-library/jest-dom/vitest';

// jsdom has no real layout engine and doesn't implement ResizeObserver at
// all — react-window's List (tests/docListVirtualization.test.tsx) uses it
// to measure its container. This is a minimal no-op stand-in: it exists so
// the constructor call doesn't throw, not to simulate real resize events.
// Only defined under jsdom; harmless if this file also runs under the
// default node environment (globalThis.ResizeObserver simply wouldn't be
// read by anything there).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver;
}

// jsdom has no canvas/rendering engine, so it doesn't implement DOMMatrix —
// pdfjs-dist (dynamically imported by src/utils/extractFileText.ts on the
// DocList upload flow) references it as soon as the module is loaded. Kept as
// a minimal no-op stand-in so any test that reaches the PDF parser doesn't
// throw, same spirit as the ResizeObserver polyfill above.
if (typeof globalThis.DOMMatrix === 'undefined') {
  class NoopDOMMatrix {
    constructor() {}
  }
  // @ts-expect-error - stand-in shape is intentionally minimal
  globalThis.DOMMatrix = NoopDOMMatrix;
}
