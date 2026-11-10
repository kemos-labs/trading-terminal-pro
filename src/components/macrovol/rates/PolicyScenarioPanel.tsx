import { useRef, useState } from 'react';
import { POLICY_SCENARIO_PATH, PolicyScenarioError, postPolicyScenario } from '../../../lib/rates/policyScenario';
import type { PolicyScenarioEnvelope, PolicyScenarioRequest } from '../../../lib/rates/policyScenario';
import { CollapsibleSection } from '../../terminal/CollapsibleSection';
import { DataBadge } from '../DataBadge';

/**
 * REF-08 policy scenario calculator (additive UI slice).
 *
 * All fixings/current prints are caller-entered; the server owns the
 * Actual/360 scenario math. Renders only response values. Missing is
 * Unavailable (never zero); exact zero stays visible.
 */

interface FixingRow {
  id: number;
  date: string;
  value: string;
}

interface MeetingRow {
  id: number;
  date: string;
  stepBps: string;
  targetLower: string;
  targetUpper: string;
}

interface WindowForm {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  currentRate: string;
  currentSource: string;
  currentDate: string;
}

const EMPTY_WINDOW: WindowForm = {
  enabled: false,
  windowStart: '',
  windowEnd: '',
  currentRate: '',
  currentSource: '',
  currentDate: '',
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseFinite(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Null-safe percent cell: null -> '—', never NaN/Infinity, exact 0 stays '0.00%'. */
function fmtPct(v: number | null | undefined, digits = 2): string {
  return v != null && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—';
}

/** Null-safe bp cell: null -> '—', exact 0 stays '+0.00 bp'. */
function fmtBp(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)} bp`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : '—';
}

interface ExecutedSummary {
  fixings: number;
  meetings: number;
  sr3: string;
  sr1: string;
  spread: string;
  derive: boolean;
  lastObservedDate: string | null;
}

export function PolicyScenarioPanel() {
  const idRef = useRef(1);
  const [fixings, setFixings] = useState<FixingRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [sr3, setSr3] = useState<WindowForm>({ ...EMPTY_WINDOW });
  const [sr1, setSr1] = useState<WindowForm>({ ...EMPTY_WINDOW });
  const [spread, setSpread] = useState('');
  const [derive, setDerive] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [validation, setValidation] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ status: number; code: string; message: string } | null>(null);
  const [envelope, setEnvelope] = useState<PolicyScenarioEnvelope | null>(null);
  const [executed, setExecuted] = useState<ExecutedSummary | null>(null);
  const [stale, setStale] = useState(false);

  const editGenRef = useRef(0);
  const requestGenRef = useRef<number | null>(null);
  const markEdited = () => {
    editGenRef.current += 1;
    if (envelope) setStale(true);
  };

  const addFixing = () => {
    setFixings((rows) => [...rows, { id: idRef.current++, date: '', value: '' }]);
    markEdited();
  };
  const removeFixing = (id: number) => {
    setFixings((rows) => rows.filter((r) => r.id !== id));
    markEdited();
  };
  const editFixing = (id: number, patch: Partial<FixingRow>) => {
    setFixings((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markEdited();
  };

  const addMeeting = () => {
    setMeetings((rows) => [...rows, { id: idRef.current++, date: '', stepBps: '', targetLower: '', targetUpper: '' }]);
    markEdited();
  };
  const removeMeeting = (id: number) => {
    setMeetings((rows) => rows.filter((r) => r.id !== id));
    markEdited();
  };
  const editMeeting = (id: number, patch: Partial<MeetingRow>) => {
    setMeetings((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markEdited();
  };

  const resetAll = () => {
    editGenRef.current += 1;
    requestGenRef.current = null;
    setFixings([]);
    setMeetings([]);
    setSr3({ ...EMPTY_WINDOW });
    setSr1({ ...EMPTY_WINDOW });
    setSpread('');
    setDerive(false);
    setPhase('idle');
    setValidation(null);
    setFailure(null);
    setEnvelope(null);
    setExecuted(null);
    setStale(false);
  };

  /** Client-side guard mirroring the exact server contract; returns body or null. */
  const buildBody = (): { body: PolicyScenarioRequest | null; error: string | null } => {
    if (fixings.length < 1) {
      return { body: null, error: 'Add at least one observed SOFR fixing before calculating.' };
    }
    if (fixings.length > 500) {
      return { body: null, error: 'At most 500 fixings are accepted.' };
    }
    const parsedFixings: { date: string; value: number }[] = [];
    for (let i = 0; i < fixings.length; i++) {
      const row = fixings[i];
      if (!row) return { body: null, error: `Fixing row ${i + 1}: missing row.` };
      if (!isCalendarDate(row.date)) {
        return { body: null, error: `Fixing row ${i + 1}: date must be YYYY-MM-DD.` };
      }
      const value = parseFinite(row.value);
      if (value == null || value < -5 || value > 30) {
        return { body: null, error: `Fixing row ${i + 1}: value must be a finite percent in [-5, 30].` };
      }
      parsedFixings.push({ date: row.date, value });
    }
    if (meetings.length > 50) {
      return { body: null, error: 'At most 50 meeting rows are accepted.' };
    }
    const parsedMeetings: NonNullable<PolicyScenarioRequest['meetings']> = [];
    for (let i = 0; i < meetings.length; i++) {
      const row = meetings[i];
      if (!row) return { body: null, error: `Meeting row ${i + 1}: missing row.` };
      if (!isCalendarDate(row.date)) {
        return { body: null, error: `Meeting row ${i + 1}: date must be YYYY-MM-DD.` };
      }
      const step = parseFinite(row.stepBps);
      if (row.stepBps.trim() !== '' && step == null) {
        return { body: null, error: `Meeting row ${i + 1}: step must be a finite number or empty.` };
      }
      if (step != null && (step < -500 || step > 500)) {
        return { body: null, error: `Meeting row ${i + 1}: step must be basis points in [-500, 500].` };
      }
      const lower = parseFinite(row.targetLower);
      const upper = parseFinite(row.targetUpper);
      if (row.targetLower.trim() !== '' && (lower == null || lower < -5 || lower > 30)) {
        return { body: null, error: `Meeting row ${i + 1}: target lower must be a finite percent in [-5, 30] or empty.` };
      }
      if (row.targetUpper.trim() !== '' && (upper == null || upper < -5 || upper > 30)) {
        return { body: null, error: `Meeting row ${i + 1}: target upper must be a finite percent in [-5, 30] or empty.` };
      }
      const entry: { date: string; stepBps?: number | null; targetLower?: number | null; targetUpper?: number | null } = {
        date: row.date,
      };
      if (step != null) entry.stepBps = step;
      if (lower != null) entry.targetLower = lower;
      if (upper != null) entry.targetUpper = upper;
      parsedMeetings.push(entry);
    }

    const buildWindow = (
      form: WindowForm,
      name: string,
    ): { window: PolicyScenarioRequest['sr3']; error: string | null } => {
      if (!form.enabled) return { window: undefined, error: null };
      if (!isCalendarDate(form.windowStart) || !isCalendarDate(form.windowEnd)) {
        return { window: undefined, error: `${name} window needs windowStart and windowEnd as YYYY-MM-DD.` };
      }
      if (form.windowEnd <= form.windowStart) {
        return { window: undefined, error: `${name} window must satisfy windowEnd > windowStart.` };
      }
      const spanDays =
        (new Date(`${form.windowEnd}T00:00:00.000Z`).getTime() -
          new Date(`${form.windowStart}T00:00:00.000Z`).getTime()) /
        86_400_000;
      if (!(spanDays > 0 && spanDays <= 400)) {
        return { window: undefined, error: `${name} window longer than 400 days is rejected.` };
      }
      const current = parseFinite(form.currentRate);
      const hasCurrent = form.currentRate.trim() !== '' || form.currentSource.trim() !== '' || form.currentDate.trim() !== '';
      if (form.currentRate.trim() !== '' && (current == null || current < -5 || current > 30)) {
        return { window: undefined, error: `${name} current rate must be a finite percent in [-5, 30] or empty.` };
      }
      if (current != null && (!form.currentSource.trim() || !isCalendarDate(form.currentDate))) {
        return {
          window: undefined,
          error: `${name} current rate needs an explicit source and date, or leave it empty (stays Unavailable).`,
        };
      }
      if (current == null && hasCurrent) {
        return {
          window: undefined,
          error: `${name} current source/date without a rate is incomplete — supply all three or leave all empty.`,
        };
      }
      const window: NonNullable<PolicyScenarioRequest['sr3']> = {
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
      };
      if (current != null) {
        window.currentRate = current;
        window.currentSource = form.currentSource.trim();
        window.currentDate = form.currentDate;
      }
      return { window, error: null };
    };

    const sr3Built = buildWindow(sr3, 'SR3');
    if (sr3Built.error) return { body: null, error: sr3Built.error };
    const sr1Built = buildWindow(sr1, 'SR1');
    if (sr1Built.error) return { body: null, error: sr1Built.error };

    const spreadValue = parseFinite(spread);
    if (spread.trim() !== '' && (spreadValue == null || spreadValue < -2000 || spreadValue > 2000)) {
      return { body: null, error: 'Spread override must be finite basis points in [-2000, 2000] or empty.' };
    }

    parsedFixings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const body: PolicyScenarioRequest = { fixings: parsedFixings };
    if (parsedMeetings.length > 0) body.meetings = parsedMeetings;
    if (sr3Built.window) body.sr3 = sr3Built.window;
    if (sr1Built.window) body.sr1 = sr1Built.window;
    body.policySpreadBps = spreadValue;
    body.deriveStepFromMidpoint = derive;
    return { body, error: null };
  };

  const calculate = async () => {
    const { body, error } = buildBody();
    if (!body) {
      setValidation(error);
      return;
    }
    setValidation(null);
    setFailure(null);
    setPhase('loading');
    const genAtRequest = editGenRef.current;
    requestGenRef.current = genAtRequest;
    try {
      const result = await postPolicyScenario(body);
      if (requestGenRef.current !== genAtRequest) return;
      const data = result.data;
      setEnvelope(result);
      setExecuted({
        fixings: body.fixings.length,
        meetings: body.meetings?.length ?? 0,
        sr3: body.sr3 ? `${body.sr3.windowStart} → ${body.sr3.windowEnd}` : 'not requested',
        sr1: body.sr1 ? `${body.sr1.windowStart} → ${body.sr1.windowEnd}` : 'not requested',
        spread: body.policySpreadBps != null ? `${body.policySpreadBps} bp` : 'not supplied (null)',
        derive: body.deriveStepFromMidpoint === true,
        lastObservedDate: data?.lastObservedDate ?? null,
      });
      if (requestGenRef.current === genAtRequest && editGenRef.current === genAtRequest) {
        setStale(false);
      } else {
        setStale(true);
      }
      setPhase('success');
    } catch (err) {
      if (requestGenRef.current !== genAtRequest) return;
      if (err instanceof PolicyScenarioError) {
        setFailure({ status: err.status, code: err.code, message: err.message });
      } else {
        setFailure({ status: 0, code: 'REQUEST_FAILED', message: err instanceof Error ? err.message : 'Request failed.' });
      }
      // A failed recalculation keeps the previous result but marks it stale.
      if (envelope) setStale(true);
      setPhase('error');
    }
  };

  const data = envelope?.data ?? null;
  const requestedWindows = [
    { key: 'sr3', label: 'SR3', row: data?.sr3 ?? null },
    { key: 'sr1', label: 'SR1', row: data?.sr1 ?? null },
  ].filter((w) => w.row != null);
  const finiteDiffs = requestedWindows
    .map((w) => w.row?.differenceBps)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const maxAbsDiff = finiteDiffs.length > 0 ? Math.max(...finiteDiffs.map((d) => Math.abs(d))) : 0;
  const resultDimmed = stale ? 'opacity-60' : '';

  return (
    <CollapsibleSection
      id="sec-policy-scenario"
      title="POLICY SCENARIO CALCULATOR"
      apis={['terminal-api', 'rates-worker']}
      defaultOpen
      storageKey="rates.sec.policy-scenario"
      subtitle="Caller-entered fixings + explicit meeting steps · scenario, never a forecast"
    >
      <p className="mt-1 text-type-2xs text-muted-foreground">
        All fixings and current prints in this calculator are caller-entered unless an explicit source and date are
        supplied. Predicted values are scenario outputs ({POLICY_SCENARIO_PATH}), never observed market data.
      </p>

      {/* ── Observed fixings ── */}
      <div className="mt-1.5 rounded border border-border bg-background/40">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/60 px-1.5 py-1">
          <span className="font-mono text-type-2xs font-semibold text-foreground">
            Observed SOFR fixings (percent, required)
          </span>
          <button
            type="button"
            aria-label="Add fixing"
            onClick={addFixing}
            className="rounded border border-border px-2 py-0.5 font-mono text-type-2xs hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            + Add fixing
          </button>
        </div>
        {fixings.length === 0 ? (
          <p className="px-1.5 py-1 font-mono text-type-2xs text-muted-foreground" data-testid="policy-no-fixings">
            No fixings yet — add at least one observed fixing (date + value) to calculate.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {fixings.map((row, i) => (
              <li key={row.id} className="flex flex-wrap items-center gap-1.5 px-1.5 py-1">
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Date
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    aria-label={`Fixing ${i + 1} date`}
                    value={row.date}
                    onChange={(e) => editFixing(row.id, { date: e.target.value })}
                    className="ml-1 w-28 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Value %
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 4.30"
                    aria-label={`Fixing ${i + 1} value percent`}
                    value={row.value}
                    onChange={(e) => editFixing(row.id, { value: e.target.value })}
                    className="ml-1 w-24 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove fixing ${i + 1}`}
                  onClick={() => removeFixing(row.id)}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-type-2xs hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Meeting rows ── */}
      <div className="mt-1.5 rounded border border-border bg-background/40">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/60 px-1.5 py-1">
          <span className="font-mono text-type-2xs font-semibold text-foreground">
            Scenario meetings (explicit steps, optional)
          </span>
          <button
            type="button"
            aria-label="Add meeting"
            onClick={addMeeting}
            className="rounded border border-border px-2 py-0.5 font-mono text-type-2xs hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            + Add meeting
          </button>
        </div>
        {meetings.length === 0 ? (
          <p className="px-1.5 py-1 font-mono text-type-2xs text-muted-foreground" data-testid="policy-no-meetings">
            No scenario meetings — steps are never inferred from target ranges unless derivation is enabled below.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {meetings.map((row, i) => (
              <li key={row.id} className="flex flex-wrap items-center gap-1.5 px-1.5 py-1">
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Date
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    aria-label={`Meeting ${i + 1} date`}
                    value={row.date}
                    onChange={(e) => editMeeting(row.id, { date: e.target.value })}
                    className="ml-1 w-28 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Step bp
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. -25"
                    aria-label={`Meeting ${i + 1} step basis points`}
                    value={row.stepBps}
                    onChange={(e) => editMeeting(row.id, { stepBps: e.target.value })}
                    className="ml-1 w-20 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Target lo %
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="display only"
                    aria-label={`Meeting ${i + 1} target lower percent`}
                    value={row.targetLower}
                    onChange={(e) => editMeeting(row.id, { targetLower: e.target.value })}
                    className="ml-1 w-20 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Target hi %
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="display only"
                    aria-label={`Meeting ${i + 1} target upper percent`}
                    value={row.targetUpper}
                    onChange={(e) => editMeeting(row.id, { targetUpper: e.target.value })}
                    className="ml-1 w-20 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove meeting ${i + 1}`}
                  onClick={() => removeMeeting(row.id)}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-type-2xs hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Optional windows ── */}
      <div className="mt-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-2">
        {([
          { name: 'SR3', form: sr3, set: setSr3, testid: 'policy-sr3' },
          { name: 'SR1', form: sr1, set: setSr1, testid: 'policy-sr1' },
        ] as const).map(({ name, form, set, testid }) => (
          <fieldset
            key={name}
            data-testid={testid}
            className="rounded border border-border bg-background/40 px-1.5 py-1"
          >
            <legend className="px-1 font-mono text-type-2xs font-semibold text-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  aria-label={`Include ${name} window`}
                  onChange={(e) => {
                    set({ ...form, enabled: e.target.checked });
                    markEdited();
                  }}
                />
                {name} window (optional)
              </label>
            </legend>
            {form.enabled ? (
              <div className="flex flex-wrap gap-1.5">
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Start
                  <input
                    type="text"
                    placeholder="YYYY-MM-DD"
                    aria-label={`${name} window start`}
                    value={form.windowStart}
                    onChange={(e) => {
                      set({ ...form, windowStart: e.target.value });
                      markEdited();
                    }}
                    className="ml-1 w-28 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  End
                  <input
                    type="text"
                    placeholder="YYYY-MM-DD"
                    aria-label={`${name} window end`}
                    value={form.windowEnd}
                    onChange={(e) => {
                      set({ ...form, windowEnd: e.target.value });
                      markEdited();
                    }}
                    className="ml-1 w-28 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Current % (obs)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="empty = Unavailable"
                    aria-label={`${name} current rate percent`}
                    value={form.currentRate}
                    onChange={(e) => {
                      set({ ...form, currentRate: e.target.value });
                      markEdited();
                    }}
                    className="ml-1 w-24 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  Source
                  <input
                    type="text"
                    placeholder="required with rate"
                    aria-label={`${name} current source`}
                    value={form.currentSource}
                    onChange={(e) => {
                      set({ ...form, currentSource: e.target.value });
                      markEdited();
                    }}
                    className="ml-1 w-28 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
                <label className="font-mono text-type-2xs text-muted-foreground">
                  As-of
                  <input
                    type="text"
                    placeholder="YYYY-MM-DD"
                    aria-label={`${name} current date`}
                    value={form.currentDate}
                    onChange={(e) => {
                      set({ ...form, currentDate: e.target.value });
                      markEdited();
                    }}
                    className="ml-1 w-28 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
                  />
                </label>
              </div>
            ) : (
              <p className="font-mono text-type-2xs text-muted-foreground">Not requested — renders as Unavailable.</p>
            )}
          </fieldset>
        ))}
      </div>

      {/* ── Spread + derivation ── */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-border bg-background/40 px-1.5 py-1">
        <label className="font-mono text-type-2xs text-muted-foreground">
          SOFR/policy spread override (bp, optional)
          <input
            type="text"
            inputMode="decimal"
            placeholder="empty = null"
            aria-label="Policy spread override basis points"
            value={spread}
            onChange={(e) => {
              setSpread(e.target.value);
              markEdited();
            }}
            className="ml-1 w-24 rounded border border-border bg-background px-1 py-0.5 font-mono text-type-2xs text-foreground"
          />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-type-2xs text-muted-foreground">
          <input
            type="checkbox"
            checked={derive}
            aria-label="Derive missing steps from target midpoints"
            onChange={(e) => {
              setDerive(e.target.checked);
              markEdited();
            }}
          />
          deriveStepFromMidpoint (default off — steps are never inferred unless enabled)
        </label>
      </div>

      {/* ── Actions ── */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={calculate}
          disabled={phase === 'loading'}
          className="rounded border border-primary bg-primary/10 px-3 py-1 font-mono text-type-xs font-semibold text-foreground hover:bg-primary/20 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {phase === 'loading' ? 'Calculating…' : 'Calculate'}
        </button>
        <button
          type="button"
          onClick={resetAll}
          className="rounded border border-border px-3 py-1 font-mono text-type-xs text-foreground hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Reset
        </button>
        {stale && envelope && (
          <span
            role="status"
            data-testid="policy-stale"
            className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-mono text-type-2xs text-warn"
          >
            Stale — edits pending, press Calculate again
          </span>
        )}
      </div>

      {validation && (
        <p role="alert" data-testid="policy-validation" className="mt-1 font-mono text-type-2xs text-warn">
          {validation}
        </p>
      )}
      {phase === 'loading' && (
        <p role="status" data-testid="policy-loading" className="mt-1 font-mono text-type-2xs text-muted-foreground">
          Calculating scenario…
        </p>
      )}
      {failure && (
        <div
          role="alert"
          data-testid={failure.status === 502 ? 'policy-provider-down' : 'policy-request-error'}
          className="mt-1 rounded border border-down/40 bg-down/5 px-1.5 py-1 font-mono text-type-2xs"
        >
          <span className="font-semibold text-down">
            {failure.status === 502 ? 'Provider unavailable (502)' : `Request invalid (${failure.status || 'error'})`} ·{' '}
            {failure.code}
          </span>
          <span className="text-muted-foreground"> — {failure.message}</span>
          {failure.status === 502 && (
            <span className="text-muted-foreground">
              {' '}
              The rates worker calculator is down; the last result (if any) stays stale below. Retry after the worker
              recovers.
            </span>
          )}
        </div>
      )}

      {/* ── Executed snapshot + results ── */}
      {executed && data && (
        <div data-testid="policy-result" className={resultDimmed}>
          <div
            data-testid="policy-executed"
            className="mt-1.5 rounded border border-border bg-background/40 px-1.5 py-1 font-mono text-type-2xs text-muted-foreground"
          >
            Executed: {executed.fixings} fixing(s) · {executed.meetings} meeting(s) · SR3 {executed.sr3} · SR1{' '}
            {executed.sr1} · spread {executed.spread} · derive {executed.derive ? 'on (server assumption shown)' : 'off'}
            {executed.lastObservedDate ? ` · last observed ${executed.lastObservedDate}` : ''}
          </div>

          {/* Fixing line */}
          <div className="mt-1.5 overflow-auto rounded border border-border" tabIndex={0} role="region" aria-label="Fixing line results">
            <table className="w-full border-collapse font-mono text-type-2xs" data-testid="policy-fixing-table">
              <caption className="px-1.5 py-1 text-left text-muted-foreground">
                Fixing line — observed vs scenario (percent), cumulative step (bp)
              </caption>
              <thead>
                <tr className="border-b border-border bg-background/60 text-left text-muted-foreground">
                  <th className="px-1.5 py-0.5">Date</th>
                  <th className="px-1.5 py-0.5 text-right">Observed</th>
                  <th className="px-1.5 py-0.5 text-right">Scenario</th>
                  <th className="px-1.5 py-0.5 text-right">Cum step</th>
                  <th className="px-1.5 py-0.5">Provenance</th>
                </tr>
              </thead>
              <tbody>
                {data.fixingLine.map((row, i) => (
                  <tr key={`${row.date ?? 'null'}-${i}`} className="border-b border-border/40">
                    <td className="px-1.5 py-0.5 tabular-nums">{row.date ?? '—'}</td>
                    <td className="px-1.5 py-0.5 text-right tabular-nums">{fmtPct(row.observedValue)}</td>
                    <td className="px-1.5 py-0.5 text-right tabular-nums">
                      {row.scenarioValue == null ? 'Unavailable' : fmtPct(row.scenarioValue)}
                    </td>
                    <td className="px-1.5 py-0.5 text-right tabular-nums">{fmtBp(row.cumulativeStepBps, 0)}</td>
                    <td className="px-1.5 py-0.5">
                      <span
                        className={`rounded border px-1 ${
                          row.provenance === 'observed'
                            ? 'border-up/40 text-up'
                            : 'border-warn/40 text-warn'
                        }`}
                      >
                        {row.provenance}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* SR3 / SR1 rows */}
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {(['sr3', 'sr1'] as const).map((key) => {
              const label = key.toUpperCase();
              const row = data[key];
              if (!row) {
                return (
                  <div
                    key={key}
                    data-testid={`policy-${key}-row`}
                    className="rounded border border-border bg-background/40 px-1.5 py-1 font-mono text-type-2xs text-muted-foreground"
                  >
                    {label}: Not requested
                  </div>
                );
              }
              return (
                <div
                  key={key}
                  data-testid={`policy-${key}-row`}
                  className="rounded border border-border bg-background/40 px-1.5 py-1 font-mono text-type-2xs"
                >
                  <div className="font-semibold text-foreground">
                    {label} · {row.windowStart ?? '—'} → {row.windowEnd ?? '—'} · status {row.status}
                  </div>
                  <dl className="mt-0.5 grid grid-cols-3 gap-1">
                    <div>
                      <dt className="text-muted-foreground">Current (obs)</dt>
                      <dd className="tabular-nums text-foreground">
                        {row.currentRate == null ? 'Unavailable' : fmtPct(row.currentRate)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Predicted (scen)</dt>
                      <dd className="tabular-nums text-foreground">
                        {row.predictedRate == null ? 'Unavailable' : fmtPct(row.predictedRate)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Δ (bp)</dt>
                      <dd className="tabular-nums text-foreground">
                        {row.differenceBps == null ? '—' : fmtBp(row.differenceBps)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-0.5 text-muted-foreground">
                    current: {row.currentProvenance} · predicted: {row.predictedProvenance}
                    {row.currentSource ? ` · ${row.currentSource}${row.currentDate ? ` ${row.currentDate}` : ''}` : ''}
                  </p>
                  {row.warnings.length > 0 && (
                    <ul className="mt-0.5 list-disc pl-4 text-warn">
                      {row.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* Residual visualization + accessible mirror table */}
          <div className="mt-1.5 rounded border border-border bg-background/40 px-1.5 py-1">
            <h4 className="font-mono text-type-2xs font-semibold text-foreground">
              Predicted − current residuals (basis points, response differenceBps only)
            </h4>
            {requestedWindows.length === 0 ? (
              <p className="font-mono text-type-2xs text-muted-foreground">No windows requested — nothing to plot.</p>
            ) : (
              <>
                <div
                  role="img"
                  aria-label={`Residuals: ${requestedWindows
                    .map((w) => `${w.label} ${w.row?.differenceBps == null ? 'unavailable' : `${w.row.differenceBps} bp`}`)
                    .join('; ')}`}
                  data-testid="policy-residual-chart"
                  className="mt-1 space-y-1"
                >
                  {requestedWindows.map((w) => {
                    const d = w.row?.differenceBps;
                    if (d == null || !Number.isFinite(d)) {
                      return (
                        <div key={w.key} data-testid={`policy-residual-${w.key}`} className="flex items-center gap-1.5 font-mono text-type-2xs">
                          <span className="w-8 text-muted-foreground">{w.label}</span>
                          <span className="text-muted-foreground">Unavailable — no residual bar</span>
                        </div>
                      );
                    }
                    const widthPct = maxAbsDiff > 0 ? (Math.abs(d) / maxAbsDiff) * 50 : 0;
                    return (
                      <div key={w.key} data-testid={`policy-residual-${w.key}`} className="flex items-center gap-1.5 font-mono text-type-2xs">
                        <span className="w-8 text-muted-foreground">{w.label}</span>
                        <span className="relative h-3 flex-1 rounded bg-background" aria-hidden="true">
                          <span className="absolute left-1/2 top-0 h-full w-px bg-muted-foreground" />
                          {d === 0 ? (
                            <span
                              className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-primary"
                              style={{ left: '50%' }}
                            />
                          ) : (
                            <span
                              className={`absolute top-0 h-full rounded ${d > 0 ? 'bg-up' : 'bg-down'}`}
                              style={
                                d > 0
                                  ? { left: '50%', width: `${widthPct}%` }
                                  : { right: '50%', width: `${widthPct}%` }
                              }
                            />
                          )}
                        </span>
                        <span className="w-24 text-right tabular-nums text-foreground">{fmtBp(d)}</span>
                      </div>
                    );
                  })}
                </div>
                <table
                  className="mt-1 w-full border-collapse font-mono text-type-2xs"
                  data-testid="policy-residual-table"
                >
                  <caption className="py-0.5 text-left text-muted-foreground">
                    Residual values mirrored from the chart (basis points)
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-0.5">Window</th>
                      <th className="py-0.5 text-right">Current %</th>
                      <th className="py-0.5 text-right">Predicted %</th>
                      <th className="py-0.5 text-right">Δ bp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestedWindows.map((w) => (
                      <tr key={w.key} className="border-b border-border/40">
                        <td className="py-0.5">{w.label}</td>
                        <td className="py-0.5 text-right tabular-nums">{fmtNum(w.row?.currentRate)}</td>
                        <td className="py-0.5 text-right tabular-nums">{fmtNum(w.row?.predictedRate)}</td>
                        <td className="py-0.5 text-right tabular-nums">
                          {w.row?.differenceBps == null ? '—' : fmtNum(w.row.differenceBps)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* Provenance / disclosure footer */}
          <div className="mt-1.5 font-mono text-type-2xs text-muted-foreground" data-testid="policy-provenance">
            <p>
              Units: rates percent-100 · differences basis points · spread{' '}
              {data.policySpreadBps == null ? 'Unavailable (not supplied)' : `${data.policySpreadBps} bp`} (
              {data.policySpreadProvenance})
              {data.lastObservedDate ? ` · last observed ${data.lastObservedDate}` : ''}
            </p>
            {(envelope?.assumptions?.length ?? 0) > 0 && (
              <details className="mt-0.5">
                <summary className="cursor-pointer text-foreground">Assumptions ({envelope?.assumptions?.length})</summary>
                <ul className="list-disc pl-4">
                  {envelope?.assumptions?.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
            {(envelope?.warnings?.length ?? 0) > 0 && (
              <ul className="mt-0.5 list-disc pl-4 text-warn">
                {envelope?.warnings?.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {envelope?.coverage && (
              <p className="mt-0.5">
                Coverage {envelope.coverage.fulfilled ?? '—'}/{envelope.coverage.requested ?? '—'}
                {(envelope.coverage.missing?.length ?? 0) > 0 ? ` · missing: ${envelope.coverage.missing?.join(', ')}` : ''}
                {envelope?.source ? ` · source: ${envelope.source.join(', ')}` : ''}
                {envelope?.fetchedAt != null ? ` · fetched ${new Date(envelope.fetchedAt).toISOString()}` : ''}
              </p>
            )}
          </div>
        </div>
      )}

      <DataBadge
        asOf={envelope?.asOf}
        source={(envelope?.source ?? []).join(', ') || 'terminal-api · rates-worker · caller-supplied-fixings'}
        note="Scenario outputs are hypothetical; current rates appear only with explicit source/date."
        className="mt-1.5"
      />
    </CollapsibleSection>
  );
}
