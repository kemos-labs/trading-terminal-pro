#!/usr/bin/env bash
# Block commits that stage secrets. .env* is gitignored and excluded.
# Run: scripts/check-secrets.sh            (staged files; pre-commit default)
#      scripts/check-secrets.sh --all      (entire tracked tree)
#      scripts/check-secrets.sh --self-test (verify detection + no false positives)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-staged}"

# ── Detection patterns ────────────────────────────────────────────────────────
# High-signal vendor token formats (always safe to match):
#   shmk_live_<hex20+>, sk-<20+>, AIza<30+>, AQ.<20+>, PEM blocks
# Provider keys: match LITERAL assignments only — quoted string after `=`.
# Reading from the environment (`process.env.X_API_KEY`, `os.getenv(...)`)
# is legitimate and must never be flagged.
_patterns() {
  cat <<'PATTERNS'
shmk_live_[a-f0-9]{20,}
sk-[a-zA-Z0-9]{20,}
AIza[0-9A-Za-z_-]{30,}
AQ\.[A-Za-z0-9_-]{20,}
-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----
[A-Z][A-Z0-9_]*API_KEY\s*=\s*['"][A-Za-z0-9_\-\.]{12,}['"]
[A-Z][A-Z0-9_]*API_KEY\s*=\s*[A-Za-z0-9_\-]{24,}\s*$
PATTERNS
}
_patterns_join() { _patterns | paste -sd'|' -; }

# ── Self-test mode ────────────────────────────────────────────────────────────
# Plants known leaks in temp files and asserts they are caught, then asserts
# legitimate source lines do NOT trip the scanner. Run in CI to keep this hook
# trustworthy (a hook that cries wolf gets bypassed — and real leaks slip by).
if [ "$MODE" = "--self-test" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  # 1) Leaks that MUST be detected
  cat > "$TMP/fake-leak.js" <<'EOF'
const cfg = {
  sahmk: '***REMOVED***',
  openai: 'sk-abcdefghijklmnopqrstuvwxyz012345',
  google: 'AIzaSyA1234567890abcdefghijklmnopqrstuv',
  fred: 'FRED_API_KEY = "***REMOVED***"',
  finnhub: "FINNHUB_API_KEY='***REMOVED***'",
};
EOF
  LEAK_HITS=$(grep -cE "$(_patterns_join)" "$TMP/fake-leak.js" || true)
  if [ "${LEAK_HITS:-0}" -lt 5 ]; then
    echo "❌ self-test FAILED: only $LEAK_HITS/5 planted leaks detected" >&2
    exit 1
  fi

  # 2) Legitimate lines that must NOT be flagged
  cat > "$TMP/legit.js" <<'EOF'
const FMP_API_KEY = process.env.FMP_API_KEY || null;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? '';
const key = SAHMK_API_KEY ?? null;
export const FRED_API_KEY = process.env.FRED_API_KEY;
if (!FLASHALPHA_API_KEY) console.warn('missing');
const id = 'shmk_live' // prefix mention without key material is fine
EOF
  if grep -qE "$(_patterns_join)" "$TMP/legit.js"; then
    echo "❌ self-test FAILED: false positive on legitimate env-read lines:" >&2
    grep -nE "$(_patterns_join)" "$TMP/legit.js" >&2 || true
    exit 1
  fi

  echo "✅ check-secrets self-test passed (leaks caught, legit env reads clean)"
  exit 0
fi

if [ "$MODE" = "--all" ]; then
  FILES=$(git ls-files -z | tr '\0' '\n' || true)
else
  FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
fi

if [ -z "${FILES//[$'\t\r\n ']/}" ]; then
  exit 0
fi

LEAKS=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .env|.env.*|*.env.local) continue ;;
  esac
  # The scanner's own self-test fixtures contain FAKE key strings — never flag them.
  [ "$f" = "scripts/check-secrets.sh" ] && continue
  [ -f "$f" ] || continue
  # skip binary-ish
  if file -b --mime-encoding "$f" 2>/dev/null | grep -qi binary; then
    continue
  fi
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    if grep -nE "$pat" "$f" 2>/dev/null; then
      LEAKS="${LEAKS}${f} matches /${pat}/"$'\n'
    fi
  done < <(_patterns)
done <<< "$FILES"

if [ -n "$LEAKS" ]; then
  echo "❌ COMMIT BLOCKED — potential secrets in staged files:" >&2
  echo "$LEAKS" >&2
  echo "Put keys only in server .env / platform env vars (gitignored). Never commit or paste into source." >&2
  exit 1
fi
exit 0
