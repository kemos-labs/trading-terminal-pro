/**
 * Subscribe to the server SSE spot stream (`/api/stream/quote/:symbol`).
 * When connected, patches the terminal store with low-latency FMP quotes
 * and suppresses redundant poll-based spot fetches via lastSpotUpdate.
 */

import { useEffect, useRef } from 'react';
import { applySpotPatch, useTerminalStore } from '../store/terminalStore';
import type { FmpQuote } from '../lib/data/types';
import { perfTimeSync } from '../config/perfBudget';
import {
  extractSurfaceMetrics,
  pushSurfaceMetrics,
} from '../lib/options/surfaceMetrics';

export interface SpotTick {
  symbol: string;
  price: number;
  change?: number;
  changePercentage?: number;
  timestamp: number;
  source: 'fmp' | 'sse';
}

/**
 * Open an EventSource to the quote stream while `enabled` is true.
 * Falls back silently if the endpoint is unavailable (Vercel / offline).
 */
export function useSpotStream(symbol: string, enabled: boolean) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !symbol) {
      esRef.current?.close();
      esRef.current = null;
      useTerminalStore.setState({ streamConnected: false });
      return;
    }

    let closed = false;
    let es: EventSource;
    try {
      es = new EventSource(`/api/stream/quote/${encodeURIComponent(symbol)}`);
    } catch {
      useTerminalStore.setState({ streamConnected: false });
      return;
    }
    esRef.current = es;

    es.onopen = () => {
      if (!closed) useTerminalStore.setState({ streamConnected: true });
    };

    es.onmessage = (ev) => {
      try {
        if (closed) return;
        const tick = JSON.parse(ev.data) as SpotTick & Partial<FmpQuote>;
        if (!tick || !(tick.price > 0)) return;
        if (tick.symbol && tick.symbol.toUpperCase() !== symbol.toUpperCase()) return;
        // Effect symbol can lag store during setSymbol → teardown; never paint wrong underlier.
        const storeSym = useTerminalStore.getState().symbol?.toUpperCase?.() ?? '';
        if (storeSym && storeSym !== symbol.toUpperCase()) return;

        const now = Date.now();
        const set = useTerminalStore.setState;
        const prev = useTerminalStore.getState();

        const quote: FmpQuote = {
          ...(prev.fmpQuote ?? ({} as FmpQuote)),
          symbol: tick.symbol || symbol,
          price: tick.price,
          change: tick.change ?? prev.fmpQuote?.change ?? 0,
          changePercentage: tick.changePercentage ?? prev.fmpQuote?.changePercentage ?? 0,
          timestamp: tick.timestamp || now,
          name: prev.fmpQuote?.name ?? '',
          dayLow: prev.fmpQuote?.dayLow ?? 0,
          dayHigh: prev.fmpQuote?.dayHigh ?? 0,
          yearHigh: prev.fmpQuote?.yearHigh ?? 0,
          yearLow: prev.fmpQuote?.yearLow ?? 0,
          volume: prev.fmpQuote?.volume ?? 0,
          marketCap: prev.fmpQuote?.marketCap ?? 0,
          priceAvg50: prev.fmpQuote?.priceAvg50 ?? 0,
          priceAvg200: prev.fmpQuote?.priceAvg200 ?? 0,
          exchange: prev.fmpQuote?.exchange ?? '',
          open: prev.fmpQuote?.open ?? 0,
          previousClose: prev.fmpQuote?.previousClose ?? 0,
        };

        set({
          fmpQuote: quote,
          fmpSpot: tick.price,
          liveAvailable: true,
          lastSpotUpdate: now,
          lastUpdate: now,
          spotSource: 'fmp',
          spotAttempted: true,
          streamConnected: true,
        });

        // Sticky-IV reprice greeks + surface at new spot (do not leave stale γ/δ).
        const snap = prev.snapshot;
        if (snap && tick.price > 0 && Math.abs(tick.price - snap.spot) / snap.spot > 0.00005) {
          const { patched, processed } = perfTimeSync('store.spotPatch.sse', () =>
            applySpotPatch(snap, tick.price, now, prev.surfaceWingMode),
          );
          const metricsFrame = extractSurfaceMetrics(patched, 'sticky_spot', now);
          set({
            snapshot: patched,
            surface: processed.surface,
            sviReadout: processed.sviReadout,
            arbResult: processed.arbResult,
            lastSurfacePath: 'sticky_spot',
            surfaceMetrics: pushSurfaceMetrics(prev.surfaceMetrics, metricsFrame),
          });
        }
      } catch {
        /* ignore malformed ticks */
      }
    };

    es.onerror = () => {
      // Browser will auto-reconnect; mark disconnected until next open.
      if (!closed) useTerminalStore.setState({ streamConnected: false });
    };

    return () => {
      closed = true;
      es.close();
      esRef.current = null;
      useTerminalStore.setState({ streamConnected: false });
    };
  }, [symbol, enabled]);
}
