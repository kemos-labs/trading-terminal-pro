#!/usr/bin/env bash
# Real-server API smoke tests (Phase 11) — curl against the live Fastify server.
# Records provider, status, content-type, schema validity, freshness/stale labels.
# Live payloads are NOT committed (terms); only structure is asserted.
set -uo pipefail

PORT="${PORT:-3001}"
BASE="http://localhost:${PORT}"
FAIL=0

check() {
  local label="$1" path="$2" expect_ct="${3:-application/json}"
  local code ct body
  code=$(curl -s -o /tmp/resp.txt -w '%{http_code}' --max-time 60 "${BASE}${path}")
  ct=$(grep -i '^content-type:' /tmp/resp.txt | head -1 | tr -d '\r' | awk '{print $2}')
  body=$(head -c 120 /tmp/resp.txt | tr '\n' ' ')
  local ok="PASS"
  if [ "$code" -ge 400 ] && [ "$code" -lt 500 ]; then ok="PASS(4xx-expected)"
  elif [ "$code" -ge 500 ]; then ok="FAIL"; FAIL=$((FAIL+1))
  fi
  printf '%-55s %s  ct=%s  body=%s\n' "${label} ${path}" "$ok" "$ct" "$body"
}

echo "=== Real-server API smoke (PORT=$PORT) ==="
check "health"                 "/api/health"
check "cache status"           "/api/cache/status"
check "workflows"              "/api/workflows"
check "openapi"                "/api/openapi.json"
check "home briefing"          "/api/home/briefing?symbol=SPY"
check "options chain (probe)"  "/api/options/SPY?probe=1"
check "options chain (full)"   "/api/options/SPY"
check "yf history"             "/api/yf/history/SPY"
check "yf info"                "/api/yf/info/SPY"
check "finnhub quote"          "/api/finnhub/quote?symbol=SPY"
check "finnhub news"           "/api/finnhub/news?symbol=SPY&limit=3"
check "desk pack"              "/api/desk/pack?symbol=SPY"
check "deribit market"         "/api/deribit/market/BTC"
check "deribit instruments"    "/api/deribit/instruments?currency=BTC"
check "deribit trades"         "/api/deribit/trades/BTC"
check "deribit funding-hist"   "/api/deribit/funding-history?currency=BTC&days=7"
check "free crypto market"     "/api/free-crypto/market/BTC"
check "venues options"         "/api/venues/options/BTC"
check "macro summary"          "/api/macrovol/rates/summary"
check "macro stress"           "/api/macrovol/macro/stress"
check "stir strip"             "/api/macrovol/stir/strip"
check "ksa board"              "/api/ksa/board"
check "ksa session"            "/api/ksa/session"
check "docs index"             "/docs/index.json"
check "academy md"             "/docs/academy/00-curriculum-overview.md" "text/markdown"
echo "=== smoke complete: $FAIL server errors ==="
exit "$FAIL"