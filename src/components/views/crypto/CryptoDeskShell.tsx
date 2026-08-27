import type { ReactNode } from 'react';
import { useTerminalStore } from '../../../store/terminalStore';
import { cn } from '../../../lib/utils';

type CryptoNavItem = { id: string; label: string; code: string };
type CryptoNavGroup = { label: string; items: CryptoNavItem[] };

const GROUPS: CryptoNavGroup[] = [
  {
    label: 'Dashboard',
    items: [{ id: 'crypto-sub-overview', label: 'Overview', code: 'OVR' }],
  },
  {
    label: 'Greeks',
    items: [
      { id: 'crypto-sub-heatmaps', label: 'Greek Exposure', code: 'HEAT' },
      { id: 'crypto-sub-levels', label: 'Key Levels', code: 'LVL' },
    ],
  },
  {
    label: 'Flow',
    items: [
      { id: 'crypto-sub-flow', label: 'Options Order Flow', code: 'FLOW' },
      { id: 'crypto-sub-oi', label: 'Open Interest', code: 'OI' },
    ],
  },
  {
    label: 'Volatility',
    items: [
      { id: 'crypto-sub-volskew', label: 'Vol & Skew', code: 'VSKW' },
      { id: 'crypto-sub-tail', label: 'Tail Strike', code: 'TAIL' },
      { id: 'crypto-sub-scanner', label: 'Scanner', code: 'SCAN' },
      { id: 'crypto-sub-options', label: 'Chain & Surfaces', code: 'VOL' },
      { id: 'crypto-sub-backtest', label: 'Strategy Lab', code: 'BT' },
    ],
  },
  {
    label: 'Futures',
    items: [
      { id: 'crypto-sub-fbasis', label: 'Basis', code: 'BAS' },
      { id: 'crypto-sub-fterm', label: 'Term Structure', code: 'TERM' },
      { id: 'crypto-sub-ffund', label: 'Funding', code: 'FUND' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { id: 'crypto-sub-calc', label: 'Option Calculator', code: 'CALC' },
      { id: 'crypto-sub-lab', label: 'Calculators', code: 'LAB' },
    ],
  },
];

export function CryptoDeskShell({ children }: { children: ReactNode }) {
  const section = useTerminalStore((s) => s.deskSectionId) ?? 'crypto-sub-overview';
  const setDeskSection = useTerminalStore((s) => s.setDeskSection);
  const symbol = useTerminalStore((s) => s.symbol);
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const setDeskContext = useTerminalStore((s) => s.setDeskContext);
  const allItems = GROUPS.flatMap((group) => group.items);
  const asset: 'BTC' | 'ETH' = symbol === 'ETH' ? 'ETH' : 'BTC';
  const spot = snapshot?.spot ?? null;

  const pickAsset = (next: 'BTC' | 'ETH') => {
    if (next === asset) return;
    const url = new URL(window.location.href);
    url.searchParams.set('crypto', next);
    window.history.replaceState({}, '', url);
    setSymbol(next);
  };

  const leaveCrypto = () => setActiveTab('vol');

  return (
    <div className="crypto-reference-shell flex h-full min-h-0 flex-col overflow-hidden bg-[#030506] text-foreground">
      {/* Top header — reference-style black bar with brand, availability, and exits. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-[#20282b] bg-[#050708] px-2 py-1 text-[11px] font-mono">
        <button
          type="button"
          onClick={leaveCrypto}
          title="Return to the main terminal"
          className="flex min-h-7 shrink-0 items-center gap-2 border border-[#2a3337] bg-[#0a0d0e] px-2 text-white transition-colors hover:border-[#25d7c5] hover:text-white"
        >
          <span className="grid h-5 w-5 place-items-center border border-[#25d7c5]/50 bg-[#25d7c5]/10 font-mono text-[10px] font-bold text-[#25d7c5]">V</span>
          <span className="font-bold tracking-[0.14em] text-white">VOLATERM</span>
          <span className="text-[#718087]">·</span>
          <span className="text-[#25d7c5] tracking-[0.16em]">CRYPTO</span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Asset selector">
          {(['BTC', 'ETH'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pickAsset(c)}
              aria-current={asset === c ? 'true' : undefined}
              className={cn(
                'min-h-7 border px-2.5 font-mono text-[11px] font-bold uppercase transition-colors',
                asset === c ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#7ee9db]' : 'border-[#2c3337] text-[#8b999f] hover:border-[#25d7c5]/60 hover:text-white',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <span className="tabular-nums font-bold text-white">
          {spot != null
            ? spot.toLocaleString(undefined, { maximumFractionDigits: spot > 1000 ? 0 : 2, minimumFractionDigits: 0 })
            : '—'}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#25d7c5]" aria-hidden />
          <span className="text-[#25d7c5] tracking-[0.12em]">DERIBIT LIVE</span>
        </span>

        <span className="ml-auto hidden text-[#76848a] xl:inline" aria-hidden>⌕ Search</span>
        <span className="ml-auto hidden text-[#7a888e] sm:inline">{allItems.length} sections · Deribit-backed</span>
        <button
          type="button"
          onClick={() => setDeskContext({ id: section, label: section, apis: ['Deribit'] })}
          className="hidden min-h-7 border border-[#2c3337] px-2 text-[#8b969a] transition-colors hover:text-white md:inline"
          aria-controls="crypto-sections"
          aria-expanded="false"
        >
          Sections
        </button>
        <button
          type="button"
          onClick={leaveCrypto}
          className="min-h-7 border border-[#2c3337] px-2 text-[#8b969a] transition-colors hover:border-[#c0392b]/70 hover:text-white"
        >
          EXIT TERMINAL
        </button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden bg-[#030506] text-foreground">
        <aside className="hidden w-[226px] shrink-0 flex-col border-r border-[#202629] bg-[#050708] lg:flex" aria-label="Crypto analytics navigation">
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" id="crypto-sections">
            {GROUPS.map((group) => (
              <section key={group.label} className="mb-4">
                <h2 className="mb-1 px-2 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#718087]">{group.label}</h2>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = section === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setDeskSection(item.id)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'min-h-9 w-full items-center gap-2 rounded-sm border-l-2 px-2.5 text-left font-mono text-[11px] transition-colors',
                          active ? 'border-[#25d7c5] bg-[#202426] text-white' : 'border-transparent text-[#a6b0b4] hover:bg-[#101416] hover:text-white',
                        )}
                      >
                        <span className={cn('w-9 text-[9px] font-bold tracking-wider', active ? 'text-[#25d7c5]' : 'text-[#59666b] group-hover:text-[#25d7c5]')}>{item.code}</span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          <div className="border-t border-[#202629] px-4 py-3 font-mono text-[10px] text-[#718087]">
            <div className="flex justify-between"><span>{asset} / USD</span><span className="text-white tabular-nums">{spot != null ? spot.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</span></div>
            <div className="mt-1 flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#25d7c5]" /><span>DERIBIT LIVE DATA</span></div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#202629] bg-[#050708] p-1 lg:hidden" aria-label="Crypto analytics sections">
            {allItems.map((item) => (
              <button key={item.id} type="button" onClick={() => setDeskSection(item.id)} aria-current={section === item.id ? 'page' : undefined} className={cn('min-h-9 shrink-0 border px-3 font-mono text-[10px] uppercase tracking-wider', section === item.id ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]' : 'border-[#202629] text-[#8b999f]')}>{item.label}</button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </div>
  );
}

