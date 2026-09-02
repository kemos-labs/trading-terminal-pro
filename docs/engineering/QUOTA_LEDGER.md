# Quota ledger deployment contract

The shared upstream cache keeps daily and monthly provider counters in memory
and optionally persists them to `QUOTA_LEDGER_PATH` (or, outside tests,
`.data/quota-ledger.json`). Writes use a same-directory temporary file followed
by an atomic rename, and the file is created with owner-only permissions.

This is restart-persistent accounting for one Node.js process. It is not a
multi-process or multi-instance quota ledger: separate processes can read the
same starting value and overwrite each other's increments because the
read/modify/write operation is not coordinated by a file lock or transactional
store. Serverless instances and horizontally scaled deployments must therefore
provide a single quota-owning process or replace this ledger with a shared
atomic counter before claiming deployment-wide quota enforcement.

The runtime exposes this distinction in `cacheStats().budgets.ledger`:

- `persistent: true`, `scope: "persistent-file-single-process"` means the
  configured file is usable for restart persistence only.
- `persistent: false`, `scope: "process-local"` means counters are in-memory
  only (the default test mode).
- `healthy` is false when persistence is unavailable or a read/write failed.

Do not place credentials or provider responses in the ledger. The file contains
only bounded provider/date counters and should live on a private, durable local
volume with mode `0600`.
