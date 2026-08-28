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
  const postsByPath = useRef<Map<string, Post>>(new Map());

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
      if (prev !== next) setActivePath(null);
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

  const listPosts = useMemo(() => {
    if (activeCategory === 'archive') return archivePosts;
    if (activeCategory === 'news' || activeCategory === 'glossary') return [];
    return archivePosts.filter((p) => p.catId === activeCategory);
  }, [archivePosts, activeCategory]);

  const glossaryEntries = useMemo(() => {
    if (!index || activeCategory !== 'glossary') return [];
    const cat = index.categories.find((c) => c.id === 'glossary');
    return (cat?.entries ?? []) as { term: string; definition: string; category: string }[];
  }, [index, activeCategory]);

  const openByPath = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const activePost = activePath
    ? postsByPath.current.get(activePath) ??
      archivePosts.find((p) => p.path === activePath) ??
      null
    : null;

  if (activePath) {
    return (
      <SectionErrorBoundary name="Academy">
        <ContentReader
          key={activePath}
          docPath={activePath.startsWith('/') ? activePath : `/${activePath}`}
          title={activePost?.title}
          subtitle={activePost?.source}
          level={activePost?.level}
          figure={activePost ? coverOf(activePost) : undefined}
          sectionLabel={activePost?.catLabel}
          onClose={() => setActivePath(null)}
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
          <div className="academy-col academy-tabs-info" aria-hidden>
            <span className="font-mono text-type-2xs text-muted-foreground">Navigate via red function bar — Home · Options · Macro · News · Glossary</span>
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
