import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEssayMeta, buildAcademyIndex } from './academyCatalog.js';

describe('academyCatalog', () => {
  it('parseEssayMeta reads title, dek, and h2 sections', () => {
    const md = `# Hello World

Short dek for the feed.

## Part one

Body.

## Part two

More.
`;
    const m = parseEssayMeta(md);
    expect(m.title).toBe('Hello World');
    expect(m.source).toMatch(/Short dek/);
    expect(m.sections.map((s) => s.heading)).toEqual(['Part one', 'Part two']);
  });

  it('buildAcademyIndex injects on-disk essays missing from index.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'acad-'));
    mkdirSync(join(root, 'markets'));
    writeFileSync(
      join(root, 'index.json'),
      JSON.stringify({
        version: 1,
        categories: [
          {
            id: 'markets',
            label: 'Markets',
            description: 'test',
            files: [
              {
                path: 'docs/markets/01-existing.md',
                title: 'Existing',
                source: 'old',
                tags: [],
                sections: [],
              },
            ],
          },
          { id: 'glossary', label: 'G', description: '', entries: [] },
        ],
      }),
    );
    writeFileSync(join(root, 'markets', '01-existing.md'), '# Existing\n\nBody.\n');
    writeFileSync(
      join(root, 'markets', 'ksa-tadawul-map.md'),
      '# KSA / Tadawul market map\n\nDesk primer for Tadawul.\n\n## Institutions\n\nCMA.\n',
    );
    writeFileSync(
      join(root, 'markets', 'EDUCATION_OPTIONS_MACROS_RATES.md'),
      '# Dump\n\nShould skip.\n',
    );
    writeFileSync(
      join(root, 'markets', 'ksa-tadawul-map.md'),
      '# KSA map\n\nDesk only — not Academy.\n',
    );
    writeFileSync(
      join(root, 'markets', 'series-new-regime-01.md'),
      '# New regime essay\n\nFull thread body for readers.\n\n## One\n\nBody.\n',
    );

    const idx = buildAcademyIndex(root);
    const markets = idx.categories.find((c) => c.id === 'markets');
    const paths = markets.files.map((f) => f.path);
    expect(paths).toContain('docs/markets/series-new-regime-01.md');
    expect(paths).toContain('docs/markets/01-existing.md');
    expect(paths.some((p) => p.includes('EDUCATION_'))).toBe(false);
    expect(paths.some((p) => p.includes('ksa-tadawul'))).toBe(false);
    expect(idx._injected).toBe(1);
  });
});
