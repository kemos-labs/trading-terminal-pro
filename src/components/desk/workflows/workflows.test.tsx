import { describe, it, expect } from 'vitest';
import { StructureWorkflow } from './StructureWorkflow';
import { PnlWorkflow } from './PnlWorkflow';
import { HedgeWorkflow } from './HedgeWorkflow';

describe('Trade workflows — 3 canonical shells', () => {
  it('StructureWorkflow is defined', () => { expect(typeof StructureWorkflow).toBe('function'); });
  it('PnlWorkflow is defined', () => { expect(typeof PnlWorkflow).toBe('function'); });
  it('HedgeWorkflow is defined', () => { expect(typeof HedgeWorkflow).toBe('function'); });
});
