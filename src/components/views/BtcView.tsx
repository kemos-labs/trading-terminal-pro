import { CRYPTO_V2 } from '../../config/featureFlags';
import { CryptoShell } from '../../features/crypto/shell/CryptoShell';
import { useTerminalStore } from '../../store/terminalStore';
import { useEffect } from 'react';

/**
 * Crypto Desk — V2 six-workflow shell when CRYPTO_V2 on, legacy placeholder when off.
 * Legacy 15-route implementation has been removed per Phase 9; this file now delegates to V2.
 */
function BtcViewContent() {
  if (CRYPTO_V2) return <CryptoShell />;
  // Legacy fallback — should not be reached in production after Phase 9 flag removal
  return (
    <div className="p-8 font-mono text-xs text-muted-foreground">
      Legacy crypto desk removed — enable VITE_CRYPTO_V2=1 for V2 workflows.
    </div>
  );
}

export function BtcView() {
  const setSymbol = useTerminalStore(s => s.setSymbol);
  const symbol = useTerminalStore(s => s.symbol);
  useEffect(() => {
    const allowed = ['BTC', 'ETH', 'IBIT', 'BITO', 'MSTR'];
    const params = new URLSearchParams(window.location.href).searchParams;
    const requested = new URL(window.location.href).searchParams.get('crypto')?.toUpperCase();
    if (requested === 'BTC' || requested === 'ETH') {
      setSymbol(requested);
    } else if (!allowed.includes(symbol)) {
      setSymbol('BTC');
    }
  }, [setSymbol, symbol]);
  return <BtcViewContent />;
}
