import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PolicyScenarioPanel } from './PolicyScenarioPanel';
import { POLICY_SCENARIO_PATH } from '../../../lib/rates/policyScenario';

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    asOf: '2026-09-16T10:00:00.000Z',
    fetchedAt: 1789500000000,
    source: ['terminal-api', 'rates-worker', 'caller-supplied-fixings'],
    freshness: 'live',
    coverage: { fulfilled: 1, requested: 1, missing: [] },
    provenanceByField: {},
    unitsByField: {},
    assumptions: ['Scenario rows are hypothetical.'],
    warnings: [],
    data: {
      fixingLine: [
        { date: '2026-09-10', observedValue: 4.3, scenarioValue: 4.3, cumulativeStepBps: 0, provenance: 'observed' },
        { date: '2026-09-11', observedValue: null, scenarioValue: 4.05, cumulativeStepBps: -25, provenance: 'scenario' },
      ],
      sr3: {
        windowStart: '2026-09-17',
        windowEnd: '2026-12-17',
        currentRate: 4.1,
        currentSource: 'caller',
        currentDate: '2026-09-16',
        currentProvenance: 'observed-caller-supplied',
        predictedRate: 4.05,
        predictedProvenance: 'scenario-compound-sofr-rate',
        differenceBps: -5,
        status: 'ok',
        warnings: [],
      },
      sr1: null,
      policySpreadBps: null,
      policySpreadProvenance: 'unavailable-not-supplied',
      lastObservedDate: '2026-09-10',
      ...overrides,
    },
  };
}

function mockFetchOnce(status: number, body: unknown) {
  const mock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchDeferred() {
  type Resolved = { ok: boolean; status: number; json: () => Promise<unknown> };
  const pending: Array<(r: Resolved) => void> = [];
  const mock = vi.fn(() => new Promise<Resolved>((resolve) => pending.push(resolve)));
  vi.stubGlobal('fetch', mock);
  const settle = (i: number, status: number, body: unknown) =>
    pending[i]?.({ ok: status >= 200 && status < 300, status, json: async () => body });
  return { mock, settle, pending };
}

async function addFixing(date: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add fixing' }));
  const rows = screen.getAllByRole('button', { name: /Remove fixing/ });
  const i = rows.length;
  fireEvent.change(screen.getByLabelText(`Fixing ${i} date`), { target: { value: date } });
  fireEvent.change(screen.getByLabelText(`Fixing ${i} value percent`), { target: { value } });
}

describe('PolicyScenarioPanel — REF08 UI slice', () => {
  it('pristine form has no seeded values and Calculate is guarded', () => {
    const fetchMock = mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
    expect(screen.getByTestId('policy-no-meetings')).toBeTruthy();
    // No seeded demo values anywhere in inputs.
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input.value).toBe('');
    expect((screen.getByLabelText('Derive missing steps from target midpoints') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(screen.getByTestId('policy-validation').textContent).toMatch(/at least one observed SOFR fixing/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('policy-result')).toBeNull();
  });

  it('POSTs the exact path/body and renders the successful response', async () => {
    const fetchMock = mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Add meeting' }));
    fireEvent.change(screen.getByLabelText('Meeting 1 date'), { target: { value: '2026-09-17' } });
    fireEvent.change(screen.getByLabelText('Meeting 1 step basis points'), { target: { value: '-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(POLICY_SCENARIO_PATH);
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.fixings).toEqual([{ date: '2026-09-10', value: 4.3 }]);
    expect(body.meetings).toEqual([{ date: '2026-09-17', stepBps: -25 }]);
    expect(body.policySpreadBps).toBeNull();
    expect(body.deriveStepFromMidpoint).toBe(false);
    expect(body.sr3).toBeUndefined();
    expect(body.sr1).toBeUndefined();
    // Fixing line renders observed + scenario with provenance pills.
    expect(screen.getByTestId('policy-fixing-table').textContent).toContain('4.30%');
    expect(screen.getByTestId('policy-fixing-table').textContent).toContain('observed');
    expect(screen.getByTestId('policy-fixing-table').textContent).toContain('scenario');
    // SR3 row renders predicted/current/difference; SR1 not requested.
    expect(screen.getByTestId('policy-sr3-row').textContent).toContain('4.05%');
    expect(screen.getByTestId('policy-sr1-row').textContent).toMatch(/Not requested/);
    // Residual bar + mirror table agree.
    expect(screen.getByTestId('policy-residual-sr3').textContent).toContain('-5.00 bp');
    expect(screen.getByTestId('policy-residual-table').textContent).toContain('-5');
    expect(screen.getByTestId('policy-executed').textContent).toMatch(/1 fixing/);
    expect(screen.getByTestId('policy-executed').textContent).toMatch(/last observed 2026-09-10/);
  });

  it('supports add/edit/remove of fixing and meeting rows plus SR1/SR3 controls', async () => {
    mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    await addFixing('2026-09-11', '4.31');
    expect(screen.getAllByRole('button', { name: /Remove fixing/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove fixing 2' }));
    expect(screen.getAllByRole('button', { name: /Remove fixing/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add meeting' }));
    expect(screen.getByLabelText('Meeting 1 target lower percent')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Meeting 1 target upper percent'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove meeting 1' }));
    expect(screen.queryByLabelText('Meeting 1 date')).toBeNull();
    // Enable SR3 window with explicit source/date triple.
    fireEvent.click(screen.getByLabelText('Include SR3 window'));
    fireEvent.change(screen.getByLabelText('SR3 window start'), { target: { value: '2026-09-17' } });
    fireEvent.change(screen.getByLabelText('SR3 window end'), { target: { value: '2026-12-17' } });
    fireEvent.change(screen.getByLabelText('SR3 current rate percent'), { target: { value: '4.1' } });
    fireEvent.change(screen.getByLabelText('SR3 current source'), { target: { value: 'caller' } });
    fireEvent.change(screen.getByLabelText('SR3 current date'), { target: { value: '2026-09-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    expect(screen.getByTestId('policy-executed').textContent).toContain('SR3 2026-09-17 → 2026-12-17');
  });

  it('Reset clears inputs and results', async () => {
    mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByTestId('policy-result')).toBeNull();
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove fixing/ })).toBeNull();
    expect((screen.getByLabelText('Policy spread override basis points') as HTMLInputElement).value).toBe('');
  });

  it('edit-after-result sets stale and does not issue a second fetch', async () => {
    const fetchMock = mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('policy-stale')).toBeNull();
    fireEvent.change(screen.getByLabelText('Fixing 1 value percent'), { target: { value: '4.35' } });
    expect(screen.getByTestId('policy-stale').textContent).toMatch(/Stale/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Old result stays visible but dimmed.
    expect(screen.getByTestId('policy-result')).toBeTruthy();
  });

  it('typed 400 is visible and keeps the prior result stale', async () => {
    const fetchMock = mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'INVALID_REQUEST', message: 'fixings must be an array of 1 to 500 rows.' } }),
    }));
    fireEvent.change(screen.getByLabelText('Fixing 1 value percent'), { target: { value: '4.35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-request-error')).toBeTruthy());
    expect(screen.getByTestId('policy-request-error').textContent).toContain('INVALID_REQUEST');
    expect(screen.getByTestId('policy-stale')).toBeTruthy();
    expect(screen.getByTestId('policy-result')).toBeTruthy();
  });

  it('typed 502 provider-down is visible and keeps the last result stale with retry guidance', async () => {
    const fetchMock = mockFetchOnce(200, successEnvelope());
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        error: { code: 'PROVIDER_UNAVAILABLE', message: 'The rates worker policy scenario calculator is unavailable.' },
      }),
    }));
    fireEvent.change(screen.getByLabelText('Fixing 1 value percent'), { target: { value: '4.35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-provider-down')).toBeTruthy());
    expect(screen.getByTestId('policy-provider-down').textContent).toContain('PROVIDER_UNAVAILABLE');
    expect(screen.getByTestId('policy-provider-down').textContent).toMatch(/Retry/);
    expect(screen.getByTestId('policy-stale')).toBeTruthy();
  });

  it('null predicted/current/difference renders Unavailable with no residual bar and no NaN', async () => {
    mockFetchOnce(
      200,
      successEnvelope({
        sr3: {
          windowStart: '2026-09-17',
          windowEnd: '2026-12-17',
          currentRate: null,
          currentSource: null,
          currentDate: null,
          currentProvenance: 'unavailable-not-supplied',
          predictedRate: null,
          predictedProvenance: 'unavailable',
          differenceBps: null,
          status: 'unavailable',
          warnings: ['sr3-predicted-unavailable'],
        },
      }),
    );
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByLabelText('Include SR3 window'));
    fireEvent.change(screen.getByLabelText('SR3 window start'), { target: { value: '2026-09-17' } });
    fireEvent.change(screen.getByLabelText('SR3 window end'), { target: { value: '2026-12-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    const sr3Text = screen.getByTestId('policy-sr3-row').textContent ?? '';
    expect(sr3Text).toContain('Unavailable');
    expect(sr3Text).not.toMatch(/(^|\s)0(\.00)?%?(\s|$)/);
    expect(screen.getByTestId('policy-residual-sr3').textContent).toMatch(/Unavailable — no residual bar/);
    expect(document.body.textContent ?? '').not.toMatch(/NaN|Infinity/);
  });

  it('exact zero stays visible as +0.00 bp and mirrors the accessible table', async () => {
    mockFetchOnce(
      200,
      successEnvelope({
        sr3: {
          windowStart: '2026-09-17',
          windowEnd: '2026-12-17',
          currentRate: 4.05,
          currentSource: 'caller',
          currentDate: '2026-09-16',
          currentProvenance: 'observed-caller-supplied',
          predictedRate: 4.05,
          predictedProvenance: 'scenario-compound-sofr-rate',
          differenceBps: 0,
          status: 'ok',
          warnings: [],
        },
      }),
    );
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    expect(screen.getByTestId('policy-residual-sr3').textContent).toContain('+0.00 bp');
    expect(screen.getByTestId('policy-residual-table').textContent).toContain('0.00');
    expect(screen.getByTestId('policy-sr3-row').textContent).toContain('+0.00 bp');
  });

  it('deferred success then Reset then resolve commits nothing (reset race)', async () => {
    const { mock, settle } = mockFetchDeferred();
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(screen.getByTestId('policy-loading')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
    expect(screen.queryByTestId('policy-loading')).toBeNull();
    await act(async () => {
      settle(0, 200, successEnvelope());
    });
    // Flush the superseded microtasks without admitting a result.
    await act(async () => {});
    expect(mock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('policy-result')).toBeNull();
    expect(screen.queryByTestId('policy-stale')).toBeNull();
    expect(screen.queryByTestId('policy-loading')).toBeNull();
    expect(screen.queryByTestId('policy-request-error')).toBeNull();
    expect(screen.queryByTestId('policy-provider-down')).toBeNull();
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Calculate' })).toBeTruthy();
  });

  it('deferred typed 400 then Reset then resolve resurrects no error banner', async () => {
    const { settle } = mockFetchDeferred();
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await act(async () => {
      settle(0, 400, { error: { code: 'INVALID_REQUEST', message: 'fixings must be an array of 1 to 500 rows.' } });
    });
    await act(async () => {});
    expect(screen.queryByTestId('policy-request-error')).toBeNull();
    expect(screen.queryByTestId('policy-provider-down')).toBeNull();
    expect(screen.queryByTestId('policy-result')).toBeNull();
    expect(screen.queryByTestId('policy-stale')).toBeNull();
    expect(screen.queryByTestId('policy-loading')).toBeNull();
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Calculate' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('request A superseded by Reset + request B never renders; B renders once', async () => {
    const { mock, settle } = mockFetchDeferred();
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    // Reset clears the form while A is pending, then a fresh B is issued.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await addFixing('2026-09-11', '4.31');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(mock).toHaveBeenCalledTimes(2);
    const bodyA = JSON.parse(String(mock.mock.calls[0]?.[1]?.body));
    const bodyB = JSON.parse(String(mock.mock.calls[1]?.[1]?.body));
    expect(bodyA.fixings).toEqual([{ date: '2026-09-10', value: 4.3 }]);
    expect(bodyB.fixings).toEqual([{ date: '2026-09-11', value: 4.31 }]);
    // Settle A first: it must never render.
    await act(async () => {
      settle(0, 200, successEnvelope({ lastObservedDate: '2026-09-10' }));
    });
    await act(async () => {});
    expect(screen.queryByTestId('policy-result')).toBeNull();
    // Settle B: exactly one result carrying B's payload.
    await act(async () => {
      settle(1, 200, successEnvelope({ lastObservedDate: '2026-09-11' }));
    });
    await waitFor(() => expect(screen.getByTestId('policy-result')).toBeTruthy());
    expect(screen.getByTestId('policy-executed').textContent).toMatch(/last observed 2026-09-11/);
    expect(screen.getAllByTestId('policy-result')).toHaveLength(1);
    expect(screen.queryByTestId('policy-stale')).toBeNull();
  });

  it('deferred response.json after Reset commits neither result nor error', async () => {
    let resolveJson: ((v: unknown) => void) | null = null;
    const jsonGate = new Promise<unknown>((resolve) => {
      resolveJson = resolve;
    });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: () => jsonGate }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PolicyScenarioPanel />);
    await addFixing('2026-09-10', '4.3');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    // Let fetch resolve so the component is parked inside `await res.json()`.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
    await act(async () => {
      resolveJson?.(successEnvelope());
    });
    await act(async () => {});
    expect(screen.queryByTestId('policy-result')).toBeNull();
    expect(screen.queryByTestId('policy-stale')).toBeNull();
    expect(screen.queryByTestId('policy-loading')).toBeNull();
    expect(screen.queryByTestId('policy-request-error')).toBeNull();
    expect(screen.queryByTestId('policy-provider-down')).toBeNull();
    expect(screen.getByTestId('policy-no-fixings')).toBeTruthy();
  });
});
