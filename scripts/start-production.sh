#!/usr/bin/env bash
# Production entrypoint: MacroVol (rates) + Node API + built SPA — one process tree, one public URL.
set -euo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export MACROVOL_API_URL="${MACROVOL_API_URL:-http://127.0.0.1:8765}"
export BACKTEST_API_URL="${BACKTEST_API_URL:-http://127.0.0.1:8766}"
export PORT="${PORT:-3001}"

MACRO_PORT=8765
BACKTEST_PORT=8766
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() {
  if [[ -n "${MACRO_PID:-}" ]] && kill -0 "$MACRO_PID" 2>/dev/null; then
    kill "$MACRO_PID" 2>/dev/null || true
    wait "$MACRO_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKTEST_PID:-}" ]] && kill -0 "$BACKTEST_PID" 2>/dev/null; then
    kill "$BACKTEST_PID" 2>/dev/null || true
    wait "$BACKTEST_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[start] MacroVol on 127.0.0.1:${MACRO_PORT}"
python3 -m uvicorn main:app \
  --app-dir macrovol-api \
  --host 127.0.0.1 \
  --port "$MACRO_PORT" \
  --log-level warning &
MACRO_PID=$!
BACKTEST_PID=

# Optional: start crypto backtest API (requires binance data)
if [[ -d "$ROOT/24h-rollout-effect" ]]; then
  echo "[start] Crypto Backtest API on 127.0.0.1:${BACKTEST_PORT}"
  python3 -m uvicorn main:app \
    --app-dir crypto-backtest-api \
    --host 127.0.0.1 \
    --port "$BACKTEST_PORT" \
    --log-level warning &
  BACKTEST_PID=$!
fi

# Wait until MacroVol answers (or give up after ~45s so Node still starts)
for i in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:${MACRO_PORT}/health" >/dev/null 2>&1; then
    echo "[start] MacroVol ready"
    break
  fi
  if ! kill -0 "$MACRO_PID" 2>/dev/null; then
    echo "[start] WARN: MacroVol exited early — rates desk may be unavailable"
    break
  fi
  sleep 1
done

if [[ -n "$BACKTEST_PID" ]] && kill -0 "$BACKTEST_PID" 2>/dev/null; then
  echo "[start] Backtest API ready"
fi

echo "[start] Node terminal on 0.0.0.0:${PORT}"
exec node server.js
