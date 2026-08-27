import { lazy, Suspense } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { useEffect } from 'react';

const CryptoShell = lazy(() => import('../../features/crypto/shell/CryptoShell').then(m => ({ default: m.CryptoShell })));

/** Crypto Desk — six-workflow V2 product (no flag). */
function BtcViewContent() {
  return (
    <Suspense fallback={<div className="p-4 font-mono text-xs animate-pulse">Loading crypto desk…</div>}>
      <CryptoShell />
    </Suspense>
  );
}

export function BtcView() {
  const setSymbol = useTerminalStore(s => s.setSymbol);
  const symbol = useTerminalStore(s => s.symbol);
  useEffect(() => {
    const allowed = ['BTC', 'ETH', 'IBIT', 'BITO', 'MSTR'];
    const requested = new URL(window.location.href).searchParams.get('crypto')?.toUpperCase();
    if (requested === 'BTC' || requested === 'ETH') {
      setSymbol(requested);
    } else if (!allowed.includes(symbol)) {
      setSymbol('BTC');
    }
  }, [setSymbol, symbol]);
  return <BtcViewContent />;
}
