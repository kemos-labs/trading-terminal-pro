import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { ContentReader } from '../academy/ContentReader';
import { GlossaryPanel } from '../academy/GlossaryPanel';
import { AcademyNews } from '../academy/AcademyNews';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';

/**
 * Academy = dark terminal education reader (syncs with app chrome).
 * Structure: masthead → section tabs → featured + archive rows → post page.
 * Education tracks: Options + Macro only. Positioning is a desk product, not Academy.
 */

interface TopicFile {
  path: string;
  title: string;
  source: string;
  tags: string[];
  level?: string;
  figure?: string;
  cover?: string;
  sections: { heading: string; source?: string; tags?: string[] }[];
}

interface AcademyIndex {
  version: number;
  title?: string;
  description?: string;
  cover?: string;
  categories: {
    id: string;
    label: string;
    description: string;
    files?: TopicFile[];
    entries?: unknown[];
  }[];
}

type Post = TopicFile & { catId: string; catLabel: string };

type CatId = 'archive' | 'options' | 'macro' | 'news' | 'glossary';

const SECTION_TO_CAT: Record<string, CatId> = {
  'academy-sub-start': 'archive',
  'academy-sub-options': 'options',
  'academy-sub-macro': 'macro',
  'academy-sub-news': 'news',
  'academy-sub-glossary': 'glossary',
  // Legacy deep-links → Home (not Academy tracks)
  'academy-sub-positioning': 'archive',
  'academy-sub-tools': 'archive',
  'academy-sub-engineering': 'archive',
  'academy-sub-design': 'archive',
};

/** Non-education categories never appear on Academy Home (or any publication tab). */
const EXCLUDED_HOME_CAT_IDS = new Set([
  'glossary',
  'tools',
  'news',
  'positioning',
  'engineering',
  'design',
]);

/** Paths that are desk/engineering notes, not Academy essays. */
function isNonAcademyPath(path: string): boolean {
  return (
    path.startsWith('docs/positioning/') ||
    path.startsWith('docs/engineering/') ||
    // Desk guides (not curriculum) — study method lives under docs/tools/06 and is OK on Start.
    /^docs\/tools\/0[1-5]-/.test(path)
  );
}

const CAT_LABEL: Record<string, string> = {
  start: 'Start',
  options: 'Options',
  macro: 'Macro',
};

function coverOf(p: TopicFile): string {
  return p.cover || p.figure || '/docs/academy/figures/covers/pub-mark.svg';
}

/**
 * Academy shareable deep links — stable query-string binding.
 *
 * Root design: desk/section routing stays owned by TerminalLayout (`?desk=` / `?sec=`).
 * Academy owns only `?q=` (search) and `?doc=` (article) and always preserves
 * every other param (desk/sec/unrelated). No new path router, no registry change:
 * registry `deepLinkFor('academy', section)` (`/?desk=academy&sec=...`) is untouched.
 *
 * Security boundary: `?doc=` is untrusted input. It is normalized by
 * `normalizeAcademyDocParam` and opened (ContentReader fetch) ONLY when the
 * normalized value is present in the loaded trusted catalog index. Unknown,
 * malformed, absolute, external, or traversal values render an explicit
 * unavailable/not-found state with catalog navigation and never fetch.
 * While the catalog is pending (or errored) an absent doc is NOT reported —
 * the loading/error state wins until the index outcome is known.
 */
export const ACADEMY_QUERY_PARAM = 'q';
export const ACADEMY_DOC_PARAM = 'doc';
const QUERY_DEBOUNCE_MS = 200;

/** Strict normalization for the untrusted `?doc=` value. Returns `docs/...` or null. */
export function normalizeAcademyDocParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.includes('\0') || v.includes('\\')) return null;
  // Absolute / external / scheme URLs are never academy docs.
  if (v.startsWith('/')) return null;
  if (v.includes('://')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(v)) return null;
  // Traversal segments are never valid, even if they would resolve inside docs/.
  const segments = v.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  if (!v.startsWith('docs/')) return null;
  if (!/^docs\/[A-Za-z0-9_.\-\/]+\.md$/.test(v)) return null;
  return v;
}

/** Read the Academy-owned params from the live URL (strict escaping via URLSearchParams). */
export function readAcademyUrl(): { query: string; docRaw: string | null } {
  try {
    const params = new URL(window.location.href).searchParams;
    return {
      query: params.get(ACADEMY_QUERY_PARAM) ?? '',
      docRaw: params.get(ACADEMY_DOC_PARAM),
    };
  } catch {
    return { query: '', docRaw: null };
  }
}

/** Write Academy-owned params, preserving desk/sec/unrelated params. */
export function writeAcademyUrl(
  next: { query?: string; doc?: string | null },
  mode: 'push' | 'replace',
): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (next.query !== undefined) {
    if (next.query === '') url.searchParams.delete(ACADEMY_QUERY_PARAM);
    else url.searchParams.set(ACADEMY_QUERY_PARAM, next.query);
  }
  if (next.doc !== undefined) {
    if (next.doc == null) url.searchParams.delete(ACADEMY_DOC_PARAM);
    else url.searchParams.set(ACADEMY_DOC_PARAM, next.doc);
  }
  const href = url.toString();
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
}

function collectTrustedPaths(indexData: AcademyIndex): Set<string> {
  const out = new Set<string>();
  for (const c of indexData.categories) {
    for (const f of c.files ?? []) {
      if (typeof f.path === 'string' && f.path) out.add(f.path);
    }
  }
  return out;
}


function catFromSection(sectionId: string | null | undefined): CatId {
  if (sectionId && SECTION_TO_CAT[sectionId]) return SECTION_TO_CAT[sectionId]!;
  return 'archive';
}

export function AcademyView() {
  const deskSectionId = useTerminalStore((s) => s.deskSectionId);
  const setDeskSection = useTerminalStore((s) => s.setDeskSection);
  const symbol = useTerminalStore((s) => s.symbol);

  const [index, setIndex] = useState<AcademyIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CatId>(() =>
    catFromSection(useTerminalStore.getState().deskSectionId),
  );
  const [activePath, setActivePath] = useState<string | null>(null);
  /** Raw `?doc=` with no trusted catalog entry (unknown/malformed/external/traversal). Never fetched. */
  const [docNotFound, setDocNotFound] = useState<string | null>(null);
  const postsByPath = useRef<Map<string, Post>>(new Map());
  /** Cold-load / back-forward `?doc=` awaiting index outcome. Never reported absent while pending. */
  const pendingDocRaw = useRef<string | null>(
    typeof window === 'undefined' ? null : readAcademyUrl().docRaw,
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/docs/index.json?v=3')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: AcademyIndex) => {
        if (!cancelled) setIndex(data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load academy index.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = useTerminalStore.getState().deskSectionId;
    if (!id || !id.startsWith('academy-sub-')) {
      setDeskSection('academy-sub-start');
      setActiveCategory('archive');
    }
  }, [setDeskSection]);

  useEffect(() => {
    if (!deskSectionId?.startsWith('academy-sub-')) return;
    const next = catFromSection(deskSectionId);
    setActiveCategory((prev) => {
      if (prev !== next) {
        pendingDocRaw.current = null;
        setActivePath(null);
        setDocNotFound(null);
        // Category switch drops the article deep link (replace: not a reader close).
        if (readAcademyUrl().docRaw != null) writeAcademyUrl({ doc: null }, 'replace');
      }
      return next;
    });
  }, [deskSectionId]);

  const archivePosts = useMemo((): Post[] => {
    if (!index) return [];
    const out: Post[] = [];
    const seen = new Set<string>();
    for (const c of index.categories) {
      if (EXCLUDED_HOME_CAT_IDS.has(c.id)) continue;
      for (const f of c.files ?? []) {
        if (seen.has(f.path)) continue;
        // Engineering / design / tools / positioning notes stay off Home feed.
        if (isNonAcademyPath(f.path)) continue;
        seen.add(f.path);
        out.push({ ...f, catId: c.id, catLabel: CAT_LABEL[c.id] || c.label });
      }
    }
    return out;
  }, [index]);

  useEffect(() => {
    const m = new Map<string, Post>();
    for (const p of archivePosts) m.set(p.path, p);
    postsByPath.current = m;
  }, [archivePosts]);

  /** Search filter — title/source/tags/sections match; applies inside archive & category lists.
   * Initial value honors a shareable `?q=` cold load; typing syncs back debounced. */
  const [query, setQuery] = useState(() =>
    typeof window === 'undefined' ? '' : readAcademyUrl().query,
  );
  const queryHydrated = useRef(false);
  const matchesQuery = useCallback((p: Post) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      p.title,
      p.source,
      p.catLabel,
      ...(p.tags ?? []),
      ...(p.sections ?? []).map((s) => s.heading ?? ''),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }, [query]);

  const listPosts = useMemo(() => {
    if (activeCategory === 'archive') return archivePosts.filter(matchesQuery);
    if (activeCategory === 'news' || activeCategory === 'glossary') return [];
    return archivePosts.filter((p) => p.catId === activeCategory).filter(matchesQuery);
  }, [archivePosts, activeCategory, matchesQuery]);

  const glossaryEntries = useMemo(() => {
    if (!index || activeCategory !== 'glossary') return [];
    const cat = index.categories.find((c) => c.id === 'glossary');
    return (cat?.entries ?? []) as { term: string; definition: string; category: string }[];
  }, [index, activeCategory]);

  const openByPath = useCallback((path: string) => {
    // Trusted-catalog gate: open (fetch) only entries present in the loaded index.
    const trusted =
      postsByPath.current.has(path) ||
      (index ? collectTrustedPaths(index).has(path) : false);
    if (trusted) {
      setDocNotFound(null);
      setActivePath(path);
      writeAcademyUrl({ doc: path }, 'push');
    } else if (index) {
      // Index outcome known and path absent (or malformed): shareable not-found, no fetch.
      setActivePath(null);
      setDocNotFound(path);
      writeAcademyUrl({ doc: path }, 'push');
    } else {
      // Catalog still pending: park the request, never report absent, never fetch.
      pendingDocRaw.current = path;
      setActivePath(null);
      setDocNotFound(null);
      writeAcademyUrl({ doc: path }, 'push');
    }
  }, [index]);

  const closeReader = useCallback(() => {
    pendingDocRaw.current = null;
    setActivePath(null);
    setDocNotFound(null);
    // Push the list state so browser back can return to the article.
    writeAcademyUrl({ doc: null }, 'push');
  }, []);

  /** Resolve an untrusted raw `?doc=` against the loaded catalog (or park while pending). */
  const resolveDocRaw = useCallback((raw: string | null) => {
    if (raw == null || raw === '') {
      pendingDocRaw.current = null;
      setActivePath(null);
      setDocNotFound(null);
      return;
    }
    const normalized = normalizeAcademyDocParam(raw);
    if (normalized == null) {
      pendingDocRaw.current = null;
      setActivePath(null);
      setDocNotFound(raw);
      return;
    }
    if (!index) {
      // Catalog outcome unknown — wait for load/error, do not report absent.
      pendingDocRaw.current = raw;
      setActivePath(null);
      setDocNotFound(null);
      return;
    }
    pendingDocRaw.current = null;
    if (collectTrustedPaths(index).has(normalized)) {
      setDocNotFound(null);
      setActivePath(normalized);
    } else {
      setActivePath(null);
      setDocNotFound(raw);
    }
  }, [index]);

  // Cold load + index arrival: resolve the parked `?doc=` once the outcome is known.
  useEffect(() => {
    if (!index) return;
    if (pendingDocRaw.current != null) resolveDocRaw(pendingDocRaw.current);
  }, [index, resolveDocRaw]);

  // Typed search syncs to `?q=` debounced via replace (no history spam), preserving params.
  useEffect(() => {
    if (!queryHydrated.current) {
      queryHydrated.current = true;
      return;
    }
    const t = window.setTimeout(() => {
      const current = readAcademyUrl().query;
      if (current !== query) writeAcademyUrl({ query }, 'replace');
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // Back/forward and cross-handler URL changes restore search + article state.
  useEffect(() => {
    const onPop = () => {
      const { query: q, docRaw } = readAcademyUrl();
      setQuery((prev) => (prev === q ? prev : q));
      resolveDocRaw(docRaw);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [resolveDocRaw]);

  // Esc closes the unavailable-link state too (reader Esc lives in ContentReader).
  useEffect(() => {
    if (!docNotFound || activePath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReader();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docNotFound, activePath, closeReader]);

  const activePost = activePath
    ? postsByPath.current.get(activePath) ??
      archivePosts.find((p) => p.path === activePath) ??
      null
    : null;

  if (activePath || docNotFound) {
    if (docNotFound && !activePath) {
      return (
        <SectionErrorBoundary name="Academy">
          <div
            className="academy-type academy-publication academy-post-page"
            data-testid="academy-doc-not-found"
          >
            <div className="academy-post-sticky">
              <div className="academy-col academy-post-sticky-inner">
                <button type="button" onClick={closeReader} className="academy-back">
                  ← Kemos Research Academy
                </button>
              </div>
            </div>
            <div className="academy-post-scroll">
              <div className="academy-col academy-post-header-block">
                <h1 className="academy-post-h1">Essay unavailable</h1>
                <p className="academy-post-subtitle">
                  No academy essay matches this link. It may be mistyped, moved, or
                  outside the academy catalog.
                </p>
                <p className="academy-dek">
                  <button type="button" onClick={closeReader} className="academy-back">
                    Browse all essays
                  </button>
                </p>
              </div>
            </div>
          </div>
        </SectionErrorBoundary>
      );
    }
    return (
      <SectionErrorBoundary name="Academy">
        <ContentReader
          key={activePath}
          docPath={activePath!.startsWith('/') ? activePath! : `/${activePath!}`}
          title={activePost?.title}
          subtitle={activePost?.source}
          level={activePost?.level}
          figure={activePost ? coverOf(activePost) : undefined}
          sectionLabel={activePost?.catLabel}
          onClose={closeReader}
        />
      </SectionErrorBoundary>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-8 academy-type academy-publication">
        <p className="academy-empty">{error}</p>
      </div>
    );
  }

  if (!index) {
    return (
      <div className="h-full flex items-center justify-center academy-type academy-publication">
        <div className="academy-loading">Loading…</div>
      </div>
    );
  }

  const featured = activeCategory === 'archive' ? listPosts[0] : null;
  const rest = featured ? listPosts.slice(1) : listPosts;
  const pubCover = index.cover || '/docs/academy/figures/covers/pub-mark.svg';

  return (
    <SectionErrorBoundary name="Academy">
      {/* Flex column: masthead never overlays feed (was paint-stacking over posts). */}
      <div
        className="academy-type academy-publication academy-root"
        data-testid="academy-root"
      >
        <div className="academy-pub-header">
          <div className="academy-col academy-masthead">
            <div className="academy-avatar" aria-hidden>
              <img src={pubCover} alt="" />
            </div>
            <div className="academy-masthead-text">
              <h1 className="academy-pub-title">{index.title || 'Kemos Research Academy'}</h1>
              <p className="academy-pub-tagline">
                {index.description ||
                  'Options and rates desk essays. Positioning is built on the POS desk — not here.'}
              </p>
              <p className="academy-pub-meta">
                {archivePosts.length} essays · By Kemos Research Desk
              </p>
            </div>
          </div>

          {/* P0 Fix: duplicated Academy nav removed — single navigation via red function bar (FunctionMenuBar). Publication tabs now live on the shell. */}
          <div className="academy-col academy-tabs-info">
            <span className="font-mono text-type-2xs text-muted-foreground">Navigate via red function bar — Home · Options · Macro · News · Glossary</span>
            <label className="mt-1 flex items-center gap-1.5 font-mono text-type-2xs">
              <span className="sr-only">Search essays</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search essays…"
                data-testid="academy-search"
                className="w-48 rounded border border-border bg-black/40 px-2 py-1 font-mono text-type-2xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>
          </div>
        </div>

        <div className="academy-scroll">
          <div className="academy-col academy-feed">
            {activeCategory === 'news' ? (
              <AcademyNews symbol={symbol || 'SPY'} />
            ) : activeCategory === 'glossary' ? (
              <div>
                <h2 className="academy-section-h">Glossary</h2>
                <p className="academy-dek">Short definitions for terms on the desks.</p>
                <div className="academy-glossary-wrap">
                  <GlossaryPanel entries={glossaryEntries} />
                </div>
              </div>
            ) : listPosts.length === 0 ? (
              <p className="academy-empty">No essays yet.</p>
            ) : (
              <div>
                {featured ? (
                  <button
                    type="button"
                    onClick={() => openByPath(featured.path)}
                    className="academy-featured group"
                    data-path={featured.path}
                  >
                    <div className="academy-featured-cover">
                      <img src={coverOf(featured)} alt="" />
                    </div>
                    <p className="academy-kicker">
                      {featured.catLabel}
                      {featured.level ? ` · ${featured.level}` : ''}
                    </p>
                    <h2 className="academy-featured-title">{featured.title}</h2>
                    {featured.source ? <p className="academy-dek">{featured.source}</p> : null}
                  </button>
                ) : null}

                <ul className="academy-archive">
                  {rest.map((file) => (
                    <li key={file.path}>
                      <PostPreviewRow post={file} onOpen={() => openByPath(file.path)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionErrorBoundary>
  );
}

function PostPreviewRow({ post, onOpen }: { post: Post; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="academy-post-preview group"
      data-path={post.path}
    >
      <div className="academy-post-preview-body">
        <p className="academy-kicker">
          {post.catLabel}
          {post.level ? ` · ${post.level}` : ''}
        </p>
        <h3 className="academy-post-title">{post.title}</h3>
        {post.source ? <p className="academy-post-dek">{post.source}</p> : null}
      </div>
      <div className="academy-post-thumb" aria-hidden>
        <img src={coverOf(post)} alt="" loading="lazy" />
      </div>
    </button>
  );
}
