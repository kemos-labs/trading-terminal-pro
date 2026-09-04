/**
 * Collect per-screenshot sidecars into one committed manifest plus
 * dependency-free pixel statistics (node:zlib only).
 *
 * Usage: node scripts/collect-screenshot-manifest.mjs [--head <sha>] [screenshotsDir]
 *
 * Reads e2e/screenshots/real-<head>-*.png + sibling .json sidecars (written
 * by e2e/real-server.spec.ts) and writes
 * docs/recovery-evidence/SCREENSHOT_MANIFEST_<head>.json containing every
 * sidecar plus automated pixel signals.
 *
 * --head scopes the manifest to one run (default: the sidecar commit head,
 * i.e. the most frequent sidecar commitShort in the directory). Every shot is
 * tagged run:'current-run' when its filename head matches the selected head,
 * otherwise run:'archival'. heads lists every parsed filename head present
 * in the directory — not just sidecar'd ones — so archival captures are
 * never silently aggregated under a run they do not belong to.
 * - dimensions, unique-color sample, mean luminance
 * - blankFraction: share of sampled pixels within 3/255 of the corner color
 *   (dead-region heuristic — a rendering failure signal, not a verdict)
 * - distinctRows: share of sampled rows that differ from their predecessor
 *   (a fully uniform capture scores ~0)
 *
 * PNG support: 8-bit truecolor/truecolor+alpha, non-interlaced. Other
 * variants are reported with stats:null and a reason (never fabricated).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function parseArgs(argv) {
  let head = null;
  let shotDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--head') {
      head = argv[++i] ?? null;
      if (!head || !/^[0-9a-f]+$/i.test(head)) {
        console.error('collect-screenshot-manifest: --head requires a hex commit prefix');
        process.exit(1);
      }
    } else if (!shotDir) {
      shotDir = argv[i];
    } else {
      console.error(`collect-screenshot-manifest: unexpected argument ${argv[i]}`);
      process.exit(1);
    }
  }
  return { headArg: head, shotDir: shotDir ?? join(ROOT, 'e2e', 'screenshots') };
}

const { headArg, shotDir } = parseArgs(process.argv.slice(2));

function readChunk(view, offset) {
  const length = view.getUint32(offset);
  const type = String.fromCharCode(
    view.getUint8(offset + 4), view.getUint8(offset + 5),
    view.getUint8(offset + 6), view.getUint8(offset + 7),
  );
  return { length, type, dataOffset: offset + 8, next: offset + 12 + length };
}

function pngStats(path) {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== PNG_SIG[i]) return { stats: null, reason: 'not-png' };
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 1;
  const idat = [];
  while (offset + 12 <= buf.byteLength) {
    const { length, type, dataOffset, next } = readChunk(view, offset);
    if (type === 'IHDR') {
      width = view.getUint32(dataOffset);
      height = view.getUint32(dataOffset + 4);
      bitDepth = view.getUint8(dataOffset + 8);
      colorType = view.getUint8(dataOffset + 9);
      interlace = view.getUint8(dataOffset + 12);
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataOffset, dataOffset + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = next;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    return { stats: null, reason: `unsupported-png bitDepth=${bitDepth} colorType=${colorType}` };
  }
  if (interlace !== 0) return { stats: null, reason: 'interlaced-png' };
  if (!width || !height || !idat.length) return { stats: null, reason: 'missing-ihdr-or-idat' };
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return { stats: null, reason: 'inflate-failed' };
  }
  // Unfilter scanlines (None/Sub/Up/Average/Paeth).
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = y * stride;
    const prev = y === 0 ? null : (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels] : 0;
      const b = prev == null ? 0 : pixels[prev + x];
      const c = prev == null || x < channels ? 0 : pixels[prev + x - channels];
      const f = raw[pos++];
      let v;
      if (filter === 0) v = f;
      else if (filter === 1) v = (f + a) & 0xff;
      else if (filter === 2) v = (f + b) & 0xff;
      else if (filter === 3) v = (f + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (f + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else {
        return { stats: null, reason: `unknown-filter-${filter}` };
      }
      pixels[row + x] = v;
    }
  }
  // Sample at most ~40k pixels on a grid for speed.
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40000)));
  const corner = [pixels[0], pixels[1], pixels[2]];
  let n = 0;
  let blank = 0;
  let lumSum = 0;
  const colors = new Set();
  let distinctRows = 0;
  let comparedRows = 0;
  let prevRowKey = '';
  for (let y = 0; y < height; y += step) {
    let rowKey = '';
    for (let x = 0; x < width; x += step) {
      const o = y * stride + x * channels;
      const r = pixels[o];
      const g = pixels[o + 1];
      const b = pixels[o + 2];
      n++;
      lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.abs(r - corner[0]) + Math.abs(g - corner[1]) + Math.abs(b - corner[2]) <= 9) blank++;
      if (colors.size < 20000) colors.add((r << 16) | (g << 8) | b);
      if (x % (step * 8) === 0) rowKey += `${r},${g},${b};`;
    }
    if (prevRowKey !== '') {
      comparedRows++;
      if (rowKey !== prevRowKey) distinctRows++;
    }
    prevRowKey = rowKey;
  }
  return {
    stats: {
      width,
      height,
      sampledPixels: n,
      meanLuminance: Number((lumSum / Math.max(1, n)).toFixed(2)),
      blankFraction: Number((blank / Math.max(1, n)).toFixed(4)),
      distinctRowFraction: comparedRows ? Number((distinctRows / comparedRows).toFixed(4)) : 0,
      sampledUniqueColors: colors.size,
    },
    reason: null,
  };
}

function main() {
  if (!existsSync(shotDir)) {
    console.error(`screenshots dir missing: ${shotDir}`);
    process.exit(1);
  }
  const files = readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
  const shots = [];
  // Every parsed filename head in the directory (sidecar'd or not).
  const parsedHeads = new Set();
  const sidecarHeadCounts = new Map();
  for (const file of files) {
    const m = /^real-([0-9a-f]+)-([a-z]+)-([a-z0-9]+)-(.+)\.png$/.exec(file);
    if (m) parsedHeads.add(m[1]);
    const sidecarPath = join(shotDir, `${file}.json`);
    let sidecar = null;
    if (existsSync(sidecarPath)) {
      try {
        sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
      } catch {
        sidecar = { error: 'sidecar-unparseable' };
      }
    }
    if (sidecar && !sidecar.error && typeof sidecar.commitShort === 'string') {
      sidecarHeadCounts.set(sidecar.commitShort, (sidecarHeadCounts.get(sidecar.commitShort) ?? 0) + 1);
    }
    const { stats, reason } = pngStats(join(shotDir, file));
    shots.push({
      file,
      parsed: m ? { head: m[1], scenario: m[2], viewport: m[3], workflow: m[4] } : null,
      sidecar,
      pixelStats: stats,
      pixelStatsReason: reason,
    });
  }
  // Default scope: the sidecar commit head (most frequent sidecar commitShort).
  // Explicit --head always wins. No sidecars at all -> 'mixed', all archival.
  let head = headArg;
  if (!head) {
    let best = null;
    let bestCount = 0;
    for (const [h, count] of sidecarHeadCounts) {
      if (count > bestCount) {
        best = h;
        bestCount = count;
      }
    }
    head = best ?? 'mixed';
  }
  for (const s of shots) {
    s.run = s.parsed && s.parsed.head === head ? 'current-run' : 'archival';
  }
  const currentRun = shots.filter((s) => s.run === 'current-run');
  const archival = shots.filter((s) => s.run === 'archival');
  const currentRunWithSidecar = currentRun.filter((s) => s.sidecar && !s.sidecar.error).length;
  const withStats = shots.filter((s) => s.pixelStats).length;
  const perHead = {};
  for (const h of [...parsedHeads].sort()) {
    const inHead = shots.filter((s) => s.parsed?.head === h);
    perHead[h] = {
      pngs: inHead.length,
      withSidecar: inHead.filter((s) => s.sidecar && !s.sidecar.error).length,
    };
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    screenshotsDir: shotDir,
    head,
    headSource: headArg ? 'cli --head' : 'sidecar-commit-head',
    heads: [...parsedHeads].sort(),
    totals: {
      pngs: shots.length,
      currentRun: currentRun.length,
      archival: archival.length,
      currentRunWithSidecar,
      withPixelStats: withStats,
    },
    perHead,
    // Automated signals only: blankFraction near 1 or distinctRowFraction near
    // 0 means look at the pixels; human visual review is still required.
    shots,
  };
  const outPath = join(ROOT, 'docs', 'recovery-evidence', `SCREENSHOT_MANIFEST_${head}.json`);
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`manifest: ${outPath}`);
  console.log(`counts: ${shots.length} pngs = ${currentRun.length} current-run + ${archival.length} archival; ${currentRunWithSidecar} current-run sidecars; ${withStats} pixel stats`);
  for (const h of [...parsedHeads].sort()) {
    console.log(`head ${h}: ${perHead[h].pngs} pngs, ${perHead[h].withSidecar} sidecars`);
  }
}

main();
