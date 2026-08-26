/**
 * News & Events inside Academy — Substack "Notes / links" style, not terminal mono strip.
 * Uses academy-* publication tokens only (no desk black-field kit).
 */
import { useEffect, useState } from 'react';
import {
  fetchFinnhubEarnings,
  fetchFinnhubNews,
  type FinnhubEarningsData,
  type FinnhubNewsItem,
} from '../../lib/data/finnhubClient';
import { macrovolApi, type SecContextData } from '../../lib/macrovol/api';
import { cn } from '../../lib/utils';

function fmtEpoch(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '';
  try {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Safe external href: news/filing URLs come from third-party feeds. React does
 * NOT sanitize hrefs, so a compromised feed could hand us `javascript:…` which
 * executes on click. Only http(s) URLs may render as anchors.
 */
function safeExternalHref(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function AcademyNews({
  symbol,
  className,
}: {
  symbol: string;
  className?: string;
}) {
  const [items, setItems] = useState<FinnhubNewsItem[]>([]);
  const [earnings, setEarnings] = useState<FinnhubEarningsData | null>(null);
  const [sec, setSec] = useState<SecContextData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const sym = symbol.toUpperCase();
    Promise.allSettled([
      fetchFinnhubNews(sym, 12),
      fetchFinnhubEarnings(sym),
      macrovolApi.secContext(sym, 6).catch(() => null),
    ]).then(([n, e, s]) => {
      if (cancelled) return;
      if (n.status === 'fulfilled') {
        setItems(n.value.items || []);
        if (n.value.error && n.value.error !== 'empty') setErr(String(n.value.error));
      } else {
        setItems([]);
        setErr('News unavailable');
      }
      if (e.status === 'fulfilled') setEarnings(e.value);
      else setEarnings(null);
      if (s.status === 'fulfilled' && s.value) setSec(s.value as SecContextData);
      else setSec(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const nextEarn = earnings?.next;
  const filings = sec?.filings?.slice(0, 5) ?? (sec?.latest ? [sec.latest] : []);
  const sym = symbol.toUpperCase();

  return (
    <div className={cn('w-full academy-type', className)} data-testid="academy-news">
      <div className="academy-news-header">
        <p className="academy-kicker academy-kicker-accent">Board · {sym}</p>
        <h2 className="academy-section-h">News & events</h2>
        <p className="academy-dek">
          Headlines and filings for the board symbol — shared cache, fail-closed. Not tips.
        </p>
      </div>

      <section className="academy-chip-row" aria-label="Upcoming events">
        {nextEarn?.date ? (
          <div className="academy-chip">
            <span className="academy-chip-label">Next earnings</span>
            <span>
              {nextEarn.date}
              {nextEarn.hour ? ` · ${nextEarn.hour}` : ''}
              {nextEarn.eps_estimate != null ? ` · est ${nextEarn.eps_estimate}` : ''}
            </span>
          </div>
        ) : null}
        {filings.slice(0, 2).map((f) => (
          <div
            key={`${f.form}-${f.filing_date}-${f.url || ''}`}
            className="academy-chip"
          >
            <span>
              SEC {f.form} · {f.filing_date}
            </span>
            {safeExternalHref(f.url) ? (
              <a href={safeExternalHref(f.url)!} target="_blank" rel="noreferrer">
                open
              </a>
            ) : null}
          </div>
        ))}
      </section>

      <section className="academy-news-section">
        <h3 className="academy-news-section-h">Headlines</h3>
        {loading ? (
          <p className="academy-empty" style={{ padding: '1.5rem 0' }}>
            Loading…
          </p>
        ) : err && !items.length ? (
          <p className="academy-dek">
            {err === 'no_api_key' ? 'Set FINNHUB_API_KEY on the server.' : err}
          </p>
        ) : items.length === 0 ? (
          <p className="academy-dek">No headlines right now (fail-closed — no demo news).</p>
        ) : (
          <ul className="academy-news-list">
            {items.map((it) => (
              <li key={String(it.id)} className="academy-news-item">
                <p className="academy-news-meta">
                  {it.source || 'News'}
                  {it.datetime ? ` · ${fmtEpoch(it.datetime)}` : ''}
                </p>
                {safeExternalHref(it.url) ? (
                  <a
                    href={safeExternalHref(it.url)!}
                    target="_blank"
                    rel="noreferrer"
                    className="academy-news-headline"
                  >
                    {it.headline}
                  </a>
                ) : (
                  <span className="academy-news-headline">{it.headline}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {filings.length > 0 ? (
        <section className="academy-news-section">
          <h3 className="academy-news-section-h">Recent SEC filings</h3>
          <ul className="academy-filing-list">
            {filings.map((f) => (
              <li
                key={`sec-${f.form}-${f.filing_date}-${f.url || f.description || ''}`}
                className="academy-filing-item"
              >
                <span>{f.form}</span>
                <span className="academy-muted"> · {f.filing_date}</span>
                {f.description ? (
                  <span className="academy-muted" style={{ display: 'block', marginTop: 2 }}>
                    {f.description}
                  </span>
                ) : null}
                {safeExternalHref(f.url) ? (
                  <a href={safeExternalHref(f.url)!} target="_blank" rel="noreferrer" className="academy-filing-link">
                    View filing →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="academy-source-note">
        Sources: Finnhub company news & earnings calendar · SEC EDGAR. Data is delayed free-tier —
        not a substitute for a compliance news desk.
      </p>
    </div>
  );
}
