import { useEffect } from 'react';
import { listFunctions } from '../../config/functionRegistry';

const SHORTCUTS = [
  { key: '1', action: 'Vol desk' },
  { key: '2', action: 'Flow desk' },
  { key: '3', action: 'Trade desk' },
  { key: '4', action: 'Crypto (BTC·ETH)' },
  { key: '5', action: 'Rates desk' },
  { key: '6', action: 'Academy' },
  { key: '7', action: 'KSA · Tadawul board' },
  { key: 'M', action: 'Trade desk' },
  { key: 'V', action: 'Vol desk' },
  { key: 'GRK', action: 'Vol · Greeks 1.0' },
  { key: '[ ]', action: 'Prev / next section' },
  { key: 'D', action: 'Toggle dense / readable' },
  { key: 'R', action: 'Refresh data' },
  { key: 'S', action: 'Search symbol' },
  { key: 'Space', action: 'Play/pause history' },
  { key: '← →', action: 'Scrub frames' },
  { key: '↑ ↓ / j k', action: 'Board row focus (chain · SR3 · SERFF · cal)' },
  { key: 'y', action: 'Copy focused cell' },
  { key: 'c', action: 'Focus option chain' },
  { key: 'Esc', action: 'Close / clear focus' },
  { key: 'L', action: 'Refresh LIVE feeds' },
  { key: '?', action: 'Toggle shortcuts' },
  { key: 'Ctrl/⌘ K', action: 'Command palette' },
  { key: 'Tab', action: 'Cycle tabs' },
];

/**
 * Compact function-code reference for the Help overlay.
 * Primary codes are authoritative; study aliases (lower-case) are listed
 * alongside as palette synonyms. Sorted by code for stable display.
 */
const FUNCTION_CODES: { code: string; aliases: string; label: string }[] = (() => {
  const seen = new Set<string>();
  const rows: { code: string; aliases: string; label: string }[] = [];
  for (const f of listFunctions()) {
    const primary = f.codes[0];
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    const aliases = f.codes.slice(1).join(' ');
    rows.push({ code: primary, aliases, label: f.label });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
})();

interface ShortcutsOverlayProps {
  onClose: () => void;
}

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg shadow-2xl p-5 w-[40rem] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-foreground mb-3 font-mono">Keyboard Shortcuts</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {SHORTCUTS.map(s => (
            <div key={s.key} className="flex items-center justify-between text-xs font-mono">
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-foreground text-type-xs">{s.key}</kbd>
              <span className="text-muted-foreground">{s.action}</span>
            </div>
          ))}
        </div>

        <h3 className="text-type-xs font-semibold text-foreground mt-5 mb-2 font-mono uppercase tracking-wider">
          Function codes
        </h3>
        <p className="text-type-2xs text-muted-foreground mb-2">
          Function codes (study aliases work in palette)
        </p>
        <div className="border border-border rounded">
          <table className="w-full font-mono text-type-2xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left px-2 py-1 font-normal w-16">Code</th>
                <th className="text-left px-2 py-1 font-normal">Aliases</th>
                <th className="text-left px-2 py-1 font-normal">Function</th>
              </tr>
            </thead>
            <tbody>
              {FUNCTION_CODES.map((r) => (
                <tr key={r.code} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1 text-primary font-semibold">{r.code}</td>
                  <td className="px-2 py-1 text-muted-foreground lowercase">{r.aliases}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-type-xs text-muted-foreground mt-4 text-center">Press Esc or ? to close</p>
      </div>
    </div>
  );
}
