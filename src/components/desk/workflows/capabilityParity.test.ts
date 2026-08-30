import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Trade & Risk capability-parity map (Phase 8).
 * The old product had 13 separate tool shells (Sim, Combo, Grid, ComboPnl,
 * OptionPnl, BreakEven, Straddle, Subjective, Backtest, Hedge, DFollow, Basis,
 * Roll). The rebuild compresses them into three canonical workflows. This test
 * proves each deleted capability has a live implementation wired into one of the
 * three workflows — source-contract level, backed by the behavior tests in
 * workflows.test.tsx and the engine unit tests.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const wfDir = import.meta.dirname;

function wfSource(name: string): string {
  return readFileSync(join(wfDir, `${name}.tsx`), 'utf8');
}

const structure = wfSource('StructureWorkflow');
const pnl = wfSource('PnlWorkflow');
const hedge = wfSource('HedgeWorkflow');

describe('Trade & Risk — 13 deleted tools → 3 workflows capability parity', () => {
  const cases: { tool: string; engine: string; workflow: string; src: string }[] = [
    { tool: 'Sim (strategy simulator)', engine: 'templateLegs', workflow: 'Structure', src: structure },
    { tool: 'Combo (multi-leg builder)', engine: 'evaluateCombo', workflow: 'Structure', src: structure },
    { tool: 'Grid (option grid)', engine: 'buildOptionGrid', workflow: 'Structure', src: structure },
    { tool: 'BreakEven', engine: 'analyzeComboBreakEven', workflow: 'Structure', src: structure },
    { tool: 'ComboPnl (combo greeks PnL)', engine: 'comboGreeksPnl', workflow: 'PnL', src: pnl },
    { tool: 'OptionPnl (single-option PnL)', engine: 'optionGreeksPnl', workflow: 'PnL', src: pnl },
    { tool: 'Straddle', engine: 'straddleBreakEvens', workflow: 'PnL', src: pnl },
    { tool: 'Subjective (scenario paths)', engine: 'evaluateSubjective', workflow: 'PnL', src: pnl },
    { tool: 'Backtest (historical replay)', engine: 'simulatePaths', workflow: 'PnL', src: pnl },
    { tool: 'Hedge (delta hedge plan)', engine: 'simulateDeltaHedge', workflow: 'PnL/Hedge', src: pnl },
    { tool: 'DFollow (Δ follower)', engine: 'defaultHedgeFromSnapshot', workflow: 'PnL/Hedge', src: pnl },
    { tool: 'Basis (roll/basis comparison)', engine: 'buildBasisCurve', workflow: 'Hedge', src: hedge },
    { tool: 'Roll (roll PnL heatmap)', engine: 'rollPnlHeatmap', workflow: 'Hedge', src: hedge },
  ];

  it.each(cases.map((c) => [c.tool, c]))('%s → wired into %s workflow', (_tool, c) => {
    expect(c.src).toContain(c.engine);
  });

  it('Hedge workflow owns the flow interpretation via the Positioning desk (no duplication)', () => {
    // interpretHedgeFlow lives once in Positioning (Book) — Trade·Hedge links to it.
    const pos = readFileSync(join(wfDir, '../../views/PositioningView.tsx'), 'utf8');
    expect(pos).toContain('interpretHedgeFlow');
  });

  it('executable-side rules are asserted by behavior tests (ask for long, bid for short)', () => {
    const tests = readFileSync(join(wfDir, 'workflows.test.tsx'), 'utf8');
    expect(tests).toContain('long entry uses ask, short entry uses bid');
    expect(tests).toContain('missing executable side produces Unavailable');
  });
});
