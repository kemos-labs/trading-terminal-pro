import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { MarkdownArticle } from './MarkdownArticle';

/**
 * Substack/Tendex post page:
 * back bar → title → subtitle → byline → cover → serif body
 * Plain block stack only — no nested <header> (global header rules collapse height).
 */

interface ContentReaderProps {
  docPath: string;
  title?: string;
  subtitle?: string;
  level?: string;
  figure?: string;
  sectionLabel?: string;
  onClose: () => void;
}

function estimateMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function ContentReader({
  docPath,
  title,
  subtitle,
  level,
  figure,
  sectionLabel,
  onClose,
}: ContentReaderProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setContent(null);
    // route-parity: /docs/*
    fetch(docPath)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) {
          setContent(null);
          setErr('Could not load this essay.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mins = content ? estimateMinutes(content) : null;

  /**
   * Keep native region scrolling: stop scroll-key propagation so the global
   * terminal shortcut layer (`useKeyboardShortcuts` ArrowDown preventDefault +
   * board-focus move) does not swallow keys while focus is in the essay body.
   * No preventDefault here — the browser performs the scroll natively.
   */
  const onRegionKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'PageDown' ||
      e.key === 'PageUp' ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.key === ' '
    ) {
      e.stopPropagation();
    }
  };

  return (
    <div
      className="academy-type academy-publication academy-post-page"
      role="article"
      aria-label={title || 'Essay'}
      data-doc={docPath}
    >
      <div className="academy-post-sticky">
        <div className="academy-col academy-post-sticky-inner">
          <button type="button" onClick={onClose} className="academy-back">
            ← Kemos Research Academy
          </button>
          <span className="academy-read-meta">
            {mins != null ? `${mins} min read` : loading ? '…' : ''}
          </span>
        </div>
      </div>

      <div className="academy-post-scroll" tabIndex={0} role="region" aria-label={title ? `${title} — essay body` : 'Essay body'} onKeyDown={onRegionKeyDown}>
        <div className="academy-col academy-post-header-block">
          {(sectionLabel || level) && (
            <p className="academy-kicker academy-kicker-accent">
              {[sectionLabel, level].filter(Boolean).join(' · ')}
            </p>
          )}
          <h1 className="academy-post-h1">{title || 'Essay'}</h1>
          {subtitle ? <p className="academy-post-subtitle">{subtitle}</p> : null}

          <div className="academy-byline">
            <div className="academy-byline-avatar" aria-hidden>
              <img src="/docs/academy/figures/covers/pub-mark.svg" alt="" />
            </div>
            <div className="academy-byline-text">
              <div className="academy-byline-name">Kemos Research Desk</div>
              <div className="academy-byline-sub">
                {mins != null ? `${mins} min read` : 'Essay'}
              </div>
            </div>
          </div>
        </div>

        {figure ? (
          <div className="academy-post-hero">
            <div className="academy-post-hero-inner">
              <img src={figure} alt="" />
            </div>
          </div>
        ) : null}

        <div className="academy-post-body-wrap">
          {loading ? (
            <p className="academy-loading">Loading essay…</p>
          ) : err ? (
            <p className="academy-dek" role="alert">
              {err}
            </p>
          ) : content ? (
            <MarkdownArticle
              markdown={content}
              docPath={docPath}
              skipFirstH1
              className={cn('academy-body-serif')}
            />
          ) : (
            <p className="academy-dek">No content.</p>
          )}
        </div>
      </div>
    </div>
  );
}
