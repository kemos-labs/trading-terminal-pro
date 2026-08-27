export type QuoteProvenance = 'observed' | 'model' | 'heuristic' | 'stale' | 'unavailable';

export interface ObservedQuote {
  strike: number;
  expiryMs: number;
  forward: number;
  iv?: number;
  bidIv?: number;
  askIv?: number;
  markIv?: number;
  provenance: QuoteProvenance;
  timestamp: number;
}

export interface SurfaceFitDiagnostics {
  model: 'svi';
  calibrationMs: number;
  forwardSource: string;
  weights: number[];
  residuals: number[];
  coverage: number; // 0..1
  constraintResults: { kind: string; passed: boolean; detail?: string }[];
  observedMask: boolean[][];
  modelMask: boolean[][];
}

export interface FittedSurface {
  totalVariance: number[][]; // w = sigma^2 T per expiry x strike
  diagnostics: SurfaceFitDiagnostics;
}
