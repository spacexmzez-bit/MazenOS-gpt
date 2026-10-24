# Verification

Build date: 2026-10-21.

## Completed locally

- 50 automated tests pass using Node's real in-memory SQLite engine behind a D1-shaped adapter, not a fake SQL parser. Each test starts with an empty database. Provider network responses are controlled test fixtures.
- The schema executes on SQLite with foreign keys enabled, is idempotent, and seeds no rows.
- Worker/frontend JavaScript syntax, local module imports, HTML asset references and 5,000-line ceilings are checked by `npm run check`.
- `npm run build` prepares an explicit public asset allowlist. Worker source, schema, test files, configuration secrets and documentation sources are not published as frontend assets.

Tests cover authentication, setup replay, logout/session revocation, CORS, login rate limiting, scoped phone access, encrypted keys, stale task edits, dependency cycles/cascades, prerequisite/subtask completion, proof-required completion, file signatures, malformed/incomplete AI output, outages, stale proofs, provider cascades, native Claude PDF payloads, bonus restoration, completed bonuses, sickness and chained recovery, daily counter idempotency, overnight rest, unique focus timers, expired sessions, hydration reminders, deadline-enforced capture, duplicate sealing, SMS parsing/deduplication, balance anchors, item-only location prices, commute gates, atomic curriculum imports, Friday scheduling, 70/30 allocation, six-message chat context, saved branches and temporary media locks. Additional regression cases cover focus with unfinished subtasks, invalidated video checks, new tasks during sickness, pre-cron health initialization, leisure unlocks, invalid bonus atomicity, drill completion timing, focus-time idea editing, in-flight key changes medicine increments, preserved milestone gaps and intense nonacademic task pauses.

## Not verified in this environment

- Browser visual rendering or interactive browser flows. The supported browser controller was unavailable; no alternate browser-control path or invented screenshots were used.
- A real Cloudflare Worker/D1/KV/Pages deployment, live cron execution, provider billing/quota/model entitlements, actual file recognition quality, or phone hardware/overlay behavior.
- A specific Saudi bank sender template or Samsung Health energy extraction.

Wrangler package downloads were blocked in the build environment. Application tests/builds need no downloaded packages and passed independently. GitHub deployment obtains Wrangler through `npx --yes wrangler@4`; it still needs your Cloudflare account configuration. Treat the included tests as local regression evidence, not proof that a live production deployment has been exercised.

Follow SETUP.html and MACRODROID.html for the remaining live checks. No production readiness claim substitutes for those checks.
