/**
 * Breadcrumb / context line under tabs (Phase C).
 * e.g. Macros & Rates › STIR PATH · API yfinance · NYFed
 */
import { useTerminalStore } from '../../store/terminalStore';
import { sectionsForTab, tabLabel } from '../../config/deskNav';
import { ApiSources } from '../macrovol/ApiSources';

export function DeskContextBar() {
  const activeTab = useTerminalStore((s) => s.activeTab);
  const sectionLabel = useTerminalStore((s) => s.deskSectionLabel);
  const apis = useTerminalStore((s) => s.deskSectionApis);
  const density = useTerminalStore((s) => s.uiDensity);
  const chainUsed = useTerminalStore((s) => s.chainUsed);
  const symbol = useTerminalStore((s) => s.symbol);
  const provenance = useTerminalStore((s) => s.provenance);
  const cryptoDualCharts = useTerminalStore((s) => s.cryptoDualCharts);

  const desk = tabLabel(activeTab);
  const hasSections = sectionsForTab(activeTab).length > 0;
  // LIVE-only: always real chainUsed / provenance — never emit chain:demo
  const chainHint =
    activeTab === 'rates' || activeTab === 'crypto' ? null : chainUsed;

  const cryptoHint =
    activeTab === 'crypto'
      ? `active:${symbol === 'ETH' ? 'ETH' : symbol === 'BTC' ? 'BTC' : symbol}${cryptoDualCharts ? ' · 2×charts' : ' · tape'}`
      : null;

  const spotProv = provenance.spot?.source;
  const chainProv = provenance.chain?.kind;

  return (
    <div
      className="term-fn-bar h-4 shrink-0 border-b border-border text-muted-foreground"
      role="status"
      aria-label="Desk context"
    >
      <span className="font-semibold text-primary">{desk}</span>
      {sectionLabel && (
        <>
          <span className="text-muted-foreground" aria-hidden>
            ›
          </span>
          <span className="font-semibold text-foreground/90">{sectionLabel}</span>
        </>
      )}
      {apis && apis.length > 0 && (
        <span className="ml-1 hidden sm:inline">
          <ApiSources apis={apis} />
        </span>
      )}
      {chainHint && (
        <span className="hidden text-muted-foreground/70 md:inline">
          · chain:{chainHint}
        </span>
      )}
      {cryptoHint && (
        <span className="hidden text-muted-foreground/70 md:inline">
          · {cryptoHint} · deribit
        </span>
      )}
      {spotProv && activeTab !== 'rates' && (
        <span className="hidden text-muted-foreground lg:inline">
          · spot:{spotProv}
          {chainProv ? ` · ${chainProv}` : ''}
        </span>
      )}
      <span className="ml-auto hidden items-center gap-2 sm:flex">
        {hasSections && (
          <>
            <span className="text-muted-foreground" title="Jump sections with [ and ]">
              [ ] section
            </span>
            <span className="text-muted-foreground/40">·</span>
          </>
        )}
        <span className="text-muted-foreground" title="Board focus: j/k · y copy · Esc clear">
          j/k focus
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="uppercase tracking-wider text-muted-foreground">
          {density}
        </span>
      </span>
    </div>
  );
}
