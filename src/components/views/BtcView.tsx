import { CryptoShell } from '../../features/crypto/shell/CryptoShell';
import { useTerminalStore } from '../../store/terminalStore';
import { useEffect } from 'react';

/** Crypto Desk — six-workflow V2 product (no flag). */
function BtcViewContent() {
  return <CryptoShell />;
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
