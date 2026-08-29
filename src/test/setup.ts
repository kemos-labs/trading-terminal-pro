import '@testing-library/jest-dom';
import * as React from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React 19 only ships `act` on the development CJS build.
// react/index.js: NODE_ENV === 'production' → react.production.js (no act).
// vitest.config.ts forces NODE_ENV=test + define so this should always pass.
// If it still fails, the production React build is on the graph — fix resolve,
// do not skip component tests.
if (typeof (React as { act?: unknown }).act !== 'function') {
  throw new Error(
    `React.act is not a function (React ${React.version}, NODE_ENV=${process.env.NODE_ENV}). ` +
      'React production builds omit act. Ensure vitest.config.ts sets define + test.env ' +
      "NODE_ENV to a non-production value (e.g. 'test'), and do not run tests with " +
      'NODE_ENV=production. See react/index.js and testing-library/react#1399.',
  );
}

// Mark this as an act environment so concurrent updates and cleanup behave.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock HTMLCanvasElement.getContext for jsdom
HTMLCanvasElement.prototype.getContext = function (): CanvasRenderingContext2D | null {
  return {
    canvas: this,
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    scale: () => {},
    setTransform: () => {},
    resetTransform: () => {},
    setLineDash: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as CanvasRenderingContext2D;
};

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
