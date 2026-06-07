import '@testing-library/jest-dom';

// jsdom does not implement ResizeObserver, which Recharts <ResponsiveContainer>
// relies on. Provide a noop polyfill so chart-bearing widgets render in tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
