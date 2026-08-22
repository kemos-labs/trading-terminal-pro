/**
 * Academy publication catalog: docs/index.json + on-disk education essays.
 * New .md under markets/options/macro/academy appears even if index is stale.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

/** Research dumps / desk notes / raw packs — not Academy feed posts. */
const SKIP_BASENAMES = new Set([
  'capital-flows-core-framework.md',
  'EDUCATION_OPTIONS_MACROS_RATES.md',
  'MACROS_GREEKS_GEX_RESEARCH.md',
  'POSITIONING_TRACE_RESEARCH.md',
  // Regional desk primer — not Academy education
  'ksa-tadawul-map.md',
  // Thin paraphrases superseded by full-thread series (files may remain on disk)
  '01-theta-is-not-free-money.md',
  '02-theta-calendar-vs-trading-time.md',
  '03-taylor-pnl-decomposition.md',
  // Macro desk paraphrases of OnlySOFRs — full series is the publication surface
  '03-money-markets-repo-hierarchy.md',
  '04-treasury-cash-futures-basis.md',
  '05-swaps-spreads-convexity.md',
  '06-relative-value-curves.md',
  '07-fx-cross-currency-basis.md',
  '08-global-flows-bop.md',
  '09-rrp-sofr-facility-corridor.md',
  '13-basis-blowup-modes.md',
]);

/** category id → relative dir under docs/ */
const TRACK_DIRS = {
  start: 'academy',
  markets: 'markets',
  options: 'options',
  macro: 'macro',
};

const DEFAULT_COVER = {
  start: '/docs/academy/figures/covers/pub-mark.svg',
  markets: '/docs/academy/figures/covers/universe-map.svg',
  options: '/docs/academy/figures/covers/vol-surface.svg',
  macro: '/docs/academy/figures/covers/gil-practice.svg',
};

/**
 * @param {string} md
 * @returns {{ title: string, source: string, sections: { heading: string, tags: string[] }[] }}
 */
export function parseEssayMeta(md) {
  const lines = String(md || '').split(/\r?\n/);
  let title = '';
  const sections = [];
  const paras = [];
  let para = [];

  const flushPara = () => {
    const t = para.join(' ').trim();
    para = [];
    if (t) paras.push(t);
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    if (h1 && !title) {
      title = h1[1].trim();
      flushPara();
      continue;
    }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      flushPara();
      sections.push({ heading: h2[1].trim(), tags: [] });
      continue;
    }
    if (/^#{1,6}\s/.test(line) || /^!\[/.test(line) || /^---+$/.test(line.trim())) {
      flushPara();
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    // skip pure table pipes for dek
    if (/^\|/.test(line.trim())) {
      flushPara();
      continue;
    }
    para.push(line.trim());
  }
  flushPara();

  // Prefer first real prose, not "Read time" meta
  let source = '';
  for (const p of paras) {
    if (/^\*\*Read time/i.test(p) || /^Who this is for/i.test(p)) continue;
    source = p.replace(/\*\*/g, '').slice(0, 180);
    break;
  }
  if (!source && paras[0]) source = paras[0].replace(/\*\*/g, '').slice(0, 180);

  return {
    title: title || 'Untitled essay',
    source,
    sections,
  };
}

/**
 * @param {string} docsRoot
 * @param {string} catId
 * @returns {string[]} absolute paths to .md files
 */
function listTrackMarkdown(docsRoot, catId) {
  const rel = TRACK_DIRS[catId];
  if (!rel) return [];
  const dir = join(docsRoot, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !SKIP_BASENAMES.has(f))
    .map((f) => join(dir, f))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

/**
 * Load index.json and inject any on-disk education essays missing from categories.
 * Missing posts are prepended (newest curriculum shows first).
 * @param {string} docsRoot absolute path to docs/
 * @returns {object} AcademyIndex-shaped JSON
 */
export function buildAcademyIndex(docsRoot) {
  const indexPath = join(docsRoot, 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error('docs/index.json missing');
  }
  /** @type {any} */
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  if (!Array.isArray(index.categories)) index.categories = [];

  const known = new Set();
  for (const c of index.categories) {
    for (const f of c.files ?? []) {
      if (f?.path) known.add(String(f.path).replace(/^\/+/, ''));
    }
  }

  let injected = 0;
  for (const cat of index.categories) {
    const catId = cat.id;
    if (!TRACK_DIRS[catId]) continue;
    if (!Array.isArray(cat.files)) cat.files = [];

    const extras = [];
    for (const abs of listTrackMarkdown(docsRoot, catId)) {
      const base = basename(abs);
      const relPath = `docs/${TRACK_DIRS[catId]}/${base}`.replace(/\\/g, '/');
      if (known.has(relPath)) continue;
      // Auto-publish only series-* bites (full threads already split). Other md must be curated in index.json.
      if (!base.startsWith('series-') && !(catId === 'start' && base.startsWith('00-'))) {
        continue;
      }
      let md = '';
      try {
        md = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      const meta = parseEssayMeta(md);
      const cover = DEFAULT_COVER[catId] || DEFAULT_COVER.markets;
      extras.push({
        path: relPath,
        title: meta.title,
        source: meta.source || 'Desk essay.',
        level: 'full thread',
        tags: [catId, 'auto-indexed', 'series'],
        sections: meta.sections.slice(0, 8),
        figure: cover,
        cover,
        featured: false,
      });
      known.add(relPath);
      injected += 1;
    }
    // Append new series (do not steal featured slot from curated index order)
    if (extras.length) {
      cat.files = [...cat.files, ...extras];
    }
  }

  index.generated = new Date().toISOString().slice(0, 10);
  index._merged = true;
  index._injected = injected;
  return index;
}

/**
 * Express/Fastify-friendly: JSON string for /docs/index.json
 * @param {string} docsRoot
 */
export function academyIndexJson(docsRoot) {
  return JSON.stringify(buildAcademyIndex(docsRoot));
}
