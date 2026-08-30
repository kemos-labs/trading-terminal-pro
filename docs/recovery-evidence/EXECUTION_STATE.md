# Execution state — running log (owner-facing transparency; final report supersedes)

## Worktree / branch
- Worktree: `/home/kalde/trading-terminal-pro-rebuild` · Branch: `codex/full-application-rebuild`
- Rollback point: `e6753aeafb57369137d0afea6c5364bcb1b6fc3f` (owner master untouched, clean)

## Commits so far
1. `3bec576` docs(recovery): Phase 0 evidence — route/defect inventory, capability map, research notes, language decision
2. `3d5fcef` fix(routes): Phase 1 — restored routes with real-server injection tests; traversal + fail-closed hardening
3. `92c8468` feat(home+shell): Phase 2 — Home briefing desk, boot never blocks, brand cleanup, workflow registry
4. `3bf755d` docs(recovery): execution state log — gates green through Phase 2, E2E 150/150
5. `a55ad5d` feat(rates): Phase 3 exemplar — 3M SOFR Futures — Implied Rate chart rebuild
6. `11acc67` feat(rates): SERFF spec compliance — exact legs+ratio title, sign-convention note, bp axis w/ zero line
7. `45bca34` feat(charts+positioning): Phase 3 — canonical HeatmapEngine + spot-centered exposure matrix
8. `30763c0` feat(vol): Phase 4 — 3D IV surface restored (lazy r3f engine) + canonical 2D matrix

## Gates status (latest)
- type-check PASS · lint 0 · build PASS (initial 139.9 kB gzip ≤250; normal chunks ≤180; IvSurface3D lazy exception 232 kB ≤300 documented cap)
- npm test --run: 120 files / 638 tests PASS
- playwright E2E: 150/150 PASS (run after Phase 2; re-run scheduled at Phase 13)
- check-secrets (all modes) PASS · npm audit 0 vulns (both modes)
- pytest macrovol-api: 22 passed 2 skipped · pip-audit: clean (direct-dependency coverage, hash-pinned lock)

## Visual reviews completed (vision subagent, deepseek-v4-flash-vision)
- Home briefing at 1440/1024/390: fixed void, three-state dots, semantic tones → usable briefing
- SOFR chart: title/unit/axis/legend/linear-segments verified; CurvesBoard duplicate removed; scored 8/10
- SERFF board: legs+ratio in title, sign note, bp axis, zero line (7→ improvements committed)
- Exposure matrix: diverging colors, hatched missing, spot ref → 8/10
- 3D IV surface: dark bg, observed dots, amber SVI mesh, ATM ridge line, labels → 8/10

## Remaining phases
- Phase 5 rest: session-change heatmap, DEX/Vanna/Charm matrix tabs on HeatmapEngine
- Phase 6 rest: UST/World dedupe audit (funding already canonical), curve-change bp panel check
- Phase 7: Crypto six workflows enrichment (primary visuals per workflow, HeatmapEngine adoption)
- Phase 8: Trade & Risk capability parity verification vs deleted 13 tools
- Phase 9: KSA polish, Academy search + deep links
- Phase 10: quota/single-flight/warmers/tab-visibility tests
- Phase 11: OpenAPI 3.1 + read-only MCP server + workflow-registry-driven descriptions
- Phase 12: cleanup, route/ bundle inventory regeneration
- Phase 13: full validation (E2E re-run, 4-viewport visual matrix on all workflows, manual checklist), final report
