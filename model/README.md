# Free AI Models from kilo & cline — Pi Integration

Two providers added to pi's `/model`: **`kilo`** and **`cline`**.

---

## `kilo` provider — 15 free models

**Endpoint:** `https://api.kilo.ai/api/gateway` (no key needed, `$0`)

| Model | Context | Notes |
|-------|---------|-------|
| Kilo Auto Free | 200K | Auto-routes best free model |
| Step 3.7 Flash | 256K | Text + vision |
| Ling 3.0 Flash | 262K | |
| Nemotron 3 Super | 262K | |
| **Nemotron 3 Ultra** | **1M** | Largest context window |
| North Mini Code | 256K | Code-optimized |
| Laguna S 2.1 | 262K | |
| Laguna M.1 | 262K | |
| Laguna XS 2.1 | 262K | |
| Nemotron 3 Nano Omni | 256K | Text + vision |
| **Gemma 4 26B** | 262K | |
| **Gemma 4 31B** | 262K | |
| Nemotron 3.5 Content Safety | 131K | No reasoning |
| Nemotron Nano 9B V2 | 131K | No reasoning |
| OpenRouter Free Router | 200K | Routes to available free model |

---

## `cline` provider — 3 free models

**Endpoint:** `https://api.cline.bot/api/v1` (uses cline's OAuth session)

| Model | Context | Status |
|-------|---------|--------|
| **DeepSeek V4 Flash** | **1M** | ✅ Works via cline's API |
| Step 3.7 Flash | 256K | Text + vision |
| Laguna S 2.1 | 262K | ✅ Works |

---

## Issues addressed

### ❌ "401 PAID_MODEL_AUTH_REQUIRED" — FIXED
DeepSeek V4 Flash was routing through kilo's gateway (which requires paid auth). Now it correctly routes through **cline's own API** at `https://api.cline.bot/api/v1` using cline's OAuth token. Tested and working.

### ❌ Usage meter not showing
The `0.0%/contextWindow` meter is auto-computed by pi from the `contextWindow` field. All models have it set. It appears in pi's toolbar footer automatically when models load. If you don't see it, close/reopen pi and type `/model` to trigger a reload.

### ❌ Will models auto-update?
**No.** The `~/.pi/agent/models.json` file is static. If kilo or cline add/remove models, this file needs manual updates. You can:
- Run the install script again when models change
- Or let me know and I'll update

---

## Files

| File | What |
|------|------|
| `~/.pi/agent/models.json` | Provider + model definitions |
| `~/.pi/agent/auth.json` | API keys (kilo=placeholder, cline=actual OAuth token) |
| `trading-terminal-pro/model/README.md` | This file |

## How to use

1. Close pi → reopen → type **`/model`**
2. Select **`kilo`** or **`cline`** from provider list
3. Pick any free model — all tested $0
