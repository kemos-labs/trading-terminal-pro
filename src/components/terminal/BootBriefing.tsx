import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  macrovolApi,
  type RatesSummary,
  type MacroSummary,
  type MacroStressPack,
  type FxBoardData,
  type TreasuryAuctionsData,
  type CryptoSpotData,
} from '../../lib/macrovol/api';
import { cn } from '../../lib/utils';
import { BRAND } from '../../config/brand';
import { BOOT_EDUCATION } from '../../config/bootEducation';

const EDU_ROTATE_MS = 8_000;

/** Free, shared upstream feeds that back the live strip. Honest vendor names only. */
type BriefApiId = 'fred-rates' | 'fred-macro' | 'fred-stress' | 'fx' | 'auctions' | 'crypto-spot';
type BriefStatus = 'pending' | 'ok' | 'fail';

const BRIEF_APIS: { id: BriefApiId; label: string }[] = [
  { id: 'fred-rates', label: 'Rates' },
  { id: 'fred-macro', label: 'Macro' },
  { id: 'fred-stress', label: 'Stress' },
  { id: 'fx', label: 'FX' },
  { id: 'auctions', label: 'Auctions' },
  { id: 'crypto-spot', label: 'Crypto' },
];

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

function fmtBpsFromPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const bps = v * 100;
  return `${bps >= 0 ? '+' : ''}${bps.toFixed(0)}bp`;
}

export type BootBriefingProps = {
  /** True when heavy desks (chain / vol) finished or timed out. */
  heavyReady: boolean;
  onEnter: () => void;
};

/**
 * Landing page — first-open screen. Brand + one action (Enter terminal) over a
 * quiet live-market strip. Data fetching stays: it warms the shared server
 * caches so the terminal opens hot behind the landing.
 */
export function BootBriefing({ heavyReady, onEnter }: BootBriefingProps) {
  const [rates, setRates] = useState<RatesSummary | null>(null);
  const [stress, setStress] = useState<MacroStressPack | null>(null);
  const [fx, setFx] = useState<FxBoardData | null>(null);
  const [, setAuctions] = useState<TreasuryAuctionsData | null>(null);
  const [crypto, setCrypto] = useState<CryptoSpotData | null>(null);
  const [, setMacro] = useState<MacroSummary | null>(null);
  const [apiStatus, setApiStatus] = useState<Record<BriefApiId, BriefStatus>>({
    'fred-rates': 'pending',
    'fred-macro': 'pending',
    'fred-stress': 'pending',
    'fx': 'pending',
    'auctions': 'pending',
    'crypto-spot': 'pending',
  });
  const entered = useRef(false);
  const [eduIdx, setEduIdx] = useState(0);

  // onEnter arrives as an inline prop from the layout (new identity every
  // render). Route it through a ref so the escape-hatch timers below are
  // never disarmed by a parent re-render — that starvation stuck the boot
  // screen at 80% forever while the chain was still warming.
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const enter = useCallback(() => {
    if (entered.current) return;
    entered.current = true;
    onEnterRef.current();
  }, []);

  // Warm every light feed; each result flips one honest status dot.
  useEffect(() => {
    let cancelled = false;
    const set = (id: BriefApiId, s: BriefStatus) =>
      setApiStatus((prev) => (prev[id] === s ? prev : { ...prev, [id]: s }));

    (async () => {
      const [r, m, st, f, a, c] = await Promise.all([
        macrovolApi.ratesSummary().then((v) => { set('fred-rates', 'ok'); return v; }).catch(() => { set('fred-rates', 'fail'); return null; }),
        macrovolApi.macroSummary().then((v) => { set('fred-macro', 'ok'); return v; }).catch(() => { set('fred-macro', 'fail'); return null; }),
        macrovolApi.macroStress().then((v) => { set('fred-stress', 'ok'); return v; }).catch(() => { set('fred-stress', 'fail'); return null; }),
        macrovolApi.ratesFx().then((v) => { set('fx', 'ok'); return v; }).catch(() => { set('fx', 'fail'); return null; }),
        macrovolApi.ratesAuctions(8).then((v) => { set('auctions', 'ok'); return v; }).catch(() => { set('auctions', 'fail'); return null; }),
        macrovolApi.cryptoSpot().then((v) => { set('crypto-spot', 'ok'); return v; }).catch(() => { set('crypto-spot', 'fail'); return null; }),
      ]);
      if (cancelled) return;
      setRates(r);
      setMacro(m);
      setStress(st);
      setFx(f);
      setAuctions(a);
      setCrypto(c);
    })();
    return () => { cancelled = true; };
  }, []);

  // Enter as soon as the heavy desks are warm — a landing shouldn't hold anyone.
  useEffect(() => {
    if (!heavyReady) return;
    const id = window.setTimeout(enter, 600);
    return () => window.clearTimeout(id);
  }, [heavyReady, enter]);

  // Provider-failure escape hatch: even with heavyReady stuck false, auto-enter
  // after 6s so a dead equity chain can never trap the user on the landing.
  useEffect(() => {
    if (heavyReady) return;
    const id = window.setTimeout(enter, 6_000);
    return () => window.clearTimeout(id);
  }, [heavyReady, enter]);

  // ⏎ enters from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter]);

  // Rotate education cards while the user looks around.
  useEffect(() => {
    const id = window.setInterval(() => {
      setEduIdx((i) => (i + 1) % BOOT_EDUCATION.length);
    }, EDU_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  const edu = BOOT_EDUCATION[eduIdx] ?? BOOT_EDUCATION[0]!;
  const topicLabel = useMemo(() => {
    switch (edu.topic) {
      case 'greeks': return 'GREEKS';
      case 'positioning': return 'POSITIONING';
      case 'rates': return 'RATES / SOFR';
      default: return 'MARKET';
    }
  }, [edu.topic]);

  const okCount = BRIEF_APIS.filter((a) => apiStatus[a.id] === 'ok').length;
  // Honest progress: light feeds are most of the work; chain readiness tops it up.
  const progress = Math.min(100, Math.round((okCount / BRIEF_APIS.length) * 80 + (heavyReady ? 20 : 0)));

  const usdjpy = fx?.pairs?.find((p) => p.pair === 'USDJPY')?.rate;
  const btc = crypto?.btc;

  const strip: { label: string; value: string }[] = [
    { label: 'SOFR', value: fmtPct(rates?.sofr) },
    { label: 'UST 10Y', value: fmtPct(rates?.usy10) },
    { label: '2s10s', value: fmtBpsFromPp(rates?.spread_2s10s) },
    { label: 'VIX', value: stress?.vix != null ? stress.vix.toFixed(1) : '—' },
    { label: 'HY OAS', value: stress?.hy_oas != null ? `${(stress.hy_oas * 100).toFixed(0)}bp` : '—' },
    { label: 'USDJPY', value: usdjpy != null ? usdjpy.toFixed(2) : '—' },
    {
      label: 'BTC',
      value:
        btc?.spot_usd != null
          ? btc.spot_usd >= 1000
            ? `$${(btc.spot_usd / 1000).toFixed(1)}k`
            : `$${btc.spot_usd.toFixed(0)}`
          : '—',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex h-dvh w-full flex-col overflow-hidden bg-[#050505] text-foreground"
      role="dialog"
      aria-label="Kemos Research — landing"
    >
      {/* Background: the boot picture, heavily dimmed so text stays readable */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <img
          src={BRAND.bootMemeSrc}
          alt=""
          className="h-full w-full object-cover opacity-[0.22]"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/60 via-[#050505]/80 to-[#050505]" />
      </div>
      {/* Quiet depth: top glow + faint grid on top of the picture */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_-5%,#12203a66_0%,transparent_60%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(#8899aa 1px, transparent 1px), linear-gradient(90deg, #8899aa 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)',
        }}
      />

      {/* Header hairline: brand · live-feed dots */}
      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-2.5 font-mono text-type-2xs uppercase tracking-[0.18em] text-muted-foreground sm:px-6">
        <span className="flex items-center gap-2">
          <span className="text-foreground">{BRAND.productName}</span>
          <span className="hidden sm:inline">· {BRAND.tagline}</span>
        </span>
        <span className="flex items-center gap-1.5" title="live feed status">
          {BRIEF_APIS.map((a) => (
            <span
              key={a.id}
              title={`${a.label}: ${apiStatus[a.id]}`}
              className="flex items-center gap-1"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-colors',
                  apiStatus[a.id] === 'ok' && 'bg-up',
                  apiStatus[a.id] === 'fail' && 'bg-down/70',
                  apiStatus[a.id] === 'pending' && 'animate-pulse bg-muted-foreground/50',
                )}
              />
              <span className="hidden md:inline">{a.label}</span>
            </span>
          ))}
        </span>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <span className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-type-2xs uppercase tracking-[0.28em] text-primary/90">
            {BRAND.tagline}
          </span>
          <h1 className="max-w-3xl text-balance font-mono text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            The market desk
            <br />
            <span className="text-muted-foreground">for people who price risk</span>
          </h1>
          <p className="max-w-xl text-pretty text-type-sm leading-relaxed text-muted-foreground">
            Vol surfaces, dealer positioning, rates plumbing and crypto greeks —
            one keyboard-driven terminal, honest free data, no fake numbers.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={enter}
            autoFocus
            className={cn(
              'group inline-flex items-center gap-3 rounded border px-7 py-3 font-mono text-type-sm uppercase tracking-[0.18em] transition-all',
              heavyReady
                ? 'border-up/60 bg-up/15 text-up hover:bg-up/25'
                : 'border-primary/50 bg-secondary hover:border-primary hover:bg-accent',
            )}
          >
            Enter terminal
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
          <span className="font-mono text-type-2xs text-muted-foreground/70">
            press ⏎ · desks open while you look around
          </span>
        </div>

        {/* Live market strip — real numbers or honest dashes */}
        <div className="mt-2 grid w-full max-w-4xl grid-cols-3 gap-px overflow-hidden rounded border border-border/50 bg-border/40 sm:grid-cols-7">
          {strip.map((s) => (
            <div key={s.label} className="bg-card/80 px-2 py-2.5 backdrop-blur-sm">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </div>
              <div className="mt-0.5 font-mono text-type-base tabular-nums tracking-tight">
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Education card — restored feature, landing-styled */}
        <div
          className="w-full max-w-4xl rounded border border-border/50 bg-card/70 px-4 py-3 text-left backdrop-blur-sm"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-type-2xs uppercase tracking-wider text-primary/80">
              While you wait · {topicLabel}
            </span>
            <div className="flex gap-1.5">
              {BOOT_EDUCATION.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={`Show tip ${i + 1}`}
                  onClick={() => setEduIdx(i)}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    i === eduIdx ? 'bg-primary' : 'bg-muted-foreground/40 hover:bg-muted-foreground/70',
                  )}
                />
              ))}
            </div>
          </div>
          <h2 className="mt-1 font-mono text-type-xs font-semibold">{edu.title}</h2>
          <p className="mt-1 text-type-xs leading-relaxed text-muted-foreground">{edu.body}</p>
          <div className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
            source: {edu.source} · educational only
          </div>
        </div>

        <a
          href={BRAND.founderXUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-type-2xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          built by {BRAND.founderName} · {BRAND.founderXHandle}
        </a>
      </main>

      {/* Bottom hairline: status + honest progress */}
      <footer className="relative z-10 shrink-0 border-t border-border/50 px-4 py-2 sm:px-6">
        <div className="mb-1.5 flex items-center justify-between font-mono text-type-2xs text-muted-foreground">
          <span>
            {heavyReady ? (
              <span className="text-up">desks ready</span>
            ) : (
              <>
                warming option chains<span className="animate-pulse">…</span>
              </>
            )}
            <span className="ml-2">
              feeds {okCount}/{BRIEF_APIS.length}
            </span>
          </span>
          <span className="tabular-nums">{progress}%</span>
        </div>
        <div className="h-px overflow-hidden bg-border/40" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Terminal load progress">
          <div
            className={cn(
              'h-full transition-[width] duration-300',
              heavyReady ? 'bg-up' : 'bg-primary/80',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </footer>
    </div>
  );
}
