import { Fragment, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Substack-style article body on academy-* publication tokens.
 * ~680px column; serif body; not terminal mono / not dense cards.
 */

function resolveImgSrc(src: string, baseDir: string): string {
  if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return src;
  if (src.startsWith('/')) return src;
  const base = baseDir.replace(/\/$/, '');
  const cleaned = src.replace(/^\.\//, '');
  return `${base}/${cleaned}`.replace(/\/+/g, '/');
}

function inlineFormat(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={k++} className="academy-md-strong">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code key={k++} className="academy-md-code">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function isTableSep(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const H_CLS = ['academy-md-h1', 'academy-md-h2', 'academy-md-h3', 'academy-md-h4'] as const;

export function MarkdownArticle({
  markdown,
  docPath,
  className,
  /** When true, skip first H1 (title already shown in Substack post header). */
  skipFirstH1 = false,
}: {
  markdown: string;
  docPath: string;
  className?: string;
  skipFirstH1?: boolean;
}) {
  const baseDir = docPath.includes('/')
    ? docPath.slice(0, docPath.lastIndexOf('/'))
    : '/docs';

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  let sawH1 = false;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        code.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={key++} className="academy-md-pre" data-lang={lang || undefined}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="academy-md-hr" />);
      i += 1;
      continue;
    }

    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) {
      const level = hm[1]!.length;
      const text = hm[2]!;
      if (level === 1 && skipFirstH1 && !sawH1) {
        sawH1 = true;
        i += 1;
        continue;
      }
      if (level === 1) sawH1 = true;
      const Tag = (`h${level}` as 'h1' | 'h2' | 'h3' | 'h4');
      blocks.push(
        <Tag key={key++} className={H_CLS[level - 1]}>
          {inlineFormat(text)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={key++} className="academy-md-quote">
          {quote.map((q, qi) => (
            <p key={qi}>{inlineFormat(q)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    const im = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (im) {
      const alt = im[1]!;
      const src = resolveImgSrc(im[2]!.trim(), baseDir);
      blocks.push(
        <figure key={key++} className="academy-md-figure">
          <div className="academy-md-figure-frame">
            <img src={src} alt={alt} loading="lazy" />
          </div>
          {alt ? <figcaption className="academy-md-figcaption">{alt}</figcaption> : null}
        </figure>,
      );
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const header = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(parseTableRow(lines[i]!));
        i += 1;
      }
      blocks.push(
        <div
          key={key++}
          className="academy-md-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={`Scrollable data table${header.length ? `: ${header.slice(0, 6).join(', ')}` : ''}`.slice(0, 140)}
        >
          <table className="academy-md-table">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{inlineFormat(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{inlineFormat(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="academy-md-ul">
          {items.map((it, ii) => (
            <li key={ii}>
              <span className="academy-md-bullet" aria-hidden>
                •
              </span>
              <span className="min-w-0">{inlineFormat(it)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="academy-md-ol">
          {items.map((it, ii) => (
            <li key={ii}>
              <span className="academy-md-num">{ii + 1}.</span>
              <span className="min-w-0">{inlineFormat(it)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^(#{1,4}\s|```|[-*]\s|\d+\.\s|!\[|\||>\s?)/.test(lines[i]!.trim()) &&
      !/^(-{3,}|\*{3,})\s*$/.test(lines[i]!.trim())
    ) {
      if (lines[i]!.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) break;
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="academy-md-p">
        {inlineFormat(para.join(' '))}
      </p>,
    );
  }

  return (
    <div className={cn('academy-md mx-auto w-full max-w-[680px]', className)} data-testid="academy-md">
      {blocks.map((b, idx) => (
        <Fragment key={idx}>{b}</Fragment>
      ))}
    </div>
  );
}
