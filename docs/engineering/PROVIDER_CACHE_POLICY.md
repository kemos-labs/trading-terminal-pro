# Provider, cache, and entitlement policy

## Shared ownership

`api/upstreamCache.js` is the process-wide last-success cache. It provides:

- one in-flight loader per canonical key;
- bounded LRU storage;
- provider-aligned TTLs;
- explicit `cacheIf` rejection so bad payloads cannot replace the last success;
- bounded stale-on-error (`maxStaleMs`, default 10× TTL);
- daily/monthly provider counters;
- hit, miss, load, coalescing, error, rejection, stale-serve, eviction, and in-flight metrics.

`/api/cache/status` exposes aggregate metrics and provider modes. Cache keys are withheld unless `EXPOSE_KEY_STATUS=1`.

## Crypto cadence

| Snapshot | Server key | TTL | Maximum stale-on-error |
|---|---|---:|---:|
| Deribit catalogue | `deribit:catalogue:{currency}` | 5 min | 24 h |
| Deribit joined market | `deribit:market:{currency}` | 20 s | 5 min |
| Deribit option trades | normalized currency/hours/count key | 5 s | 1 min |
| Deribit funding | currency/days key | 1 min | 5 min |
| Public Binance/Bybit snapshot | `free-crypto:{currency}` | 15 s | 2 min |

The joined Deribit market snapshot owns catalogue, bulk option/future quotes, perpetual ticker, and index calls. Concurrent v1 clients join one loader. A route-level integration test proves eight clients create five calls total (one provider call for each required Deribit method), rather than eight complete fills.

Browser recurring refreshes in the terminal store, crypto dual-book hook, futures hook, funding hook, KSA board, boot briefing, and shared strip check `document.hidden`. Server caching remains authoritative even if clients refresh together.

## Velo entitlement policy

`server/providers/entitlements.js` checks credentials without returning their values.

- No Velo credential: mode is `free-alternatives`; panels identify Binance Futures and Bybit Linear as provider-native and **not Velo-normalized**.
- Credential plus explicit Velo base configuration: mode is `velo-configuration-detected`; it does not claim a connector is active.
- Credential without endpoint configuration: mode is `configuration-error`; canonical selection must fail closed and must not silently substitute free data.

At this audit point no Velo environment variable is present, so the required path is the explicitly labelled public-alternative path. The detector is covered for absent, partial, and configured states. A production Velo payload connector remains a blocker if credentials are supplied; no unverified vendor schema is invented.
