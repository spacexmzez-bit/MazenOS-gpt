# MazenOS

A personal command center for one authenticated user. Dashboard chat with Ari and Jade sits above links to separate task, curriculum, health, medicine, recovery, budget, location, idea, diary and leisure pages.

**Start with `SETUP.html`.** This is a complete new project, not an overlay patch for the old Taskitator repository. Deploy it to a **new repository, new D1 database and new Pages project**. It does not alter your existing Taskitator app or import its accounts, tasks or keys. Tables begin empty; no demo records, demo chat, simulated approvals or client-only replacement database are shipped.

## Included

- Vanilla multipage frontend with shared responsive dark styling, accessible forms and dismissible dialogs.
- Cloudflare Worker, unified relational D1 schema, temporary KV media flags, daily 03:00 Riyadh maintenance and GitHub push-to-deploy workflow.
- One password and shared short-lived browser bearer session; scoped phone token; password-confirmed encrypted provider key storage; direct logout and password change.
- Task priorities, prerequisites and cycle checks, subtasks, upcoming/completed views, dependency rescheduling, exact bonus return times, focus timers, photo/PDF audits and receipts.
- Chat history, branching from any saved message, at most six provider context messages, confirmed task suggestions, and an explicit Jade weekly diary debrief.
- Health check-ins, medicine counters, recovery pauses with deadline restoration, and phone energy-score webhook.
- Curriculum JSON import without an AI request, 65–75% main allocation, exam-based promotion, subject-page hooks and confirmed retrieval drills.
- Locations with optional average/item prices and round-trip commute checks; Markdown diary formatting; signed wallet ledger with conservative English/Arabic SMS parsing and deduplication.
- Server-enforced three-minute idea capture with draft autosave, focus-time vault restrictions, Friday AI synthesis download and editing outside focus.
- Friday protection and scheduled leisure windows; food/water reminders after 150 minutes of uninterrupted logged focus.

## Implementation phases

The package includes all four phases, assembled in this order:

1. **Foundation:** shared schema, root layout, authentication, encryption, routes and dashboard.
2. **Execution:** Taskitator, proof checks, focus, illness controls and phone status.
3. **Tools:** Curry, locations, ideas, diary, budget and leisure.
4. **Delivery:** configuration, GitHub deployment, setup/MacroDroid guides and automated checks.

## Important implementation choices

- The uploaded `Taskitator-main-7.zip` was inspected as the behavior reference. Its proof gateway, timer, safe-label rendering and task dependencies informed this implementation. Its Clerk/Durable Object/account-billing model conflicts with the requested single-user D1 architecture, so the application shell and persistence layer were rebuilt. Old projects, recurrence, billing, account deletion and other features outside the MazenOS prompt were not carried over. Original license attribution is retained in `LICENSE` and `SOURCE-NOTES.md`.
- A full-access bearer on the phone would unnecessarily expose journals and keys. All browser pages share one session; the phone uses a separate credential restricted to the four documented integration endpoints.
- Browser sessions are authoritative in D1 for immediate logout/revocation. KV holds short-lived video checks and media lock flags. KV is eventually consistent; a phone flag may take time to propagate.
- Friday and scheduled leisure windows are unlocked periods, so the Friday safeguard works even if an old task remains overdue. Sickness and configured rest windows also take precedence over device locks.
- State injection uses compact JSON with a **360-byte bound**, aimed at a small token budget. The detailed example in the prompt cannot reliably fit under 120 tokens across providers and languages. An exact provider-independent token ceiling is not claimed. The static persona, latest chat messages, and optional diary debrief are separate prompt costs.
- MacroDroid/NewPipe titles can indicate relevance; they cannot prove that you watched a video. Completion still requires the submitted photo/PDF to pass the task’s exact criteria. Editing a task invalidates the prior video check.
- Samsung Health does not expose a direct API to a static browser page. Manual energy entry works; automatic sync requires your Android-side bridge to read the value and POST it.
- A local timer cannot make a phone resistant to its owner disabling MacroDroid. The guide provides a recovery path and keeps communication/emergency apps outside an overlay. API failures never fabricate an audit pass.

## AI models

Defaults verified on 2026-10-21:

| Provider | Light | Smart |
|---|---|---|
| Gemini | `gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite` on 429 | `gemini-3.8-flash`, then `gemini-3.6-flash` on 429 |
| Claude | `claude-haiku-5-5` | `claude-sonnet-5-5` |

The prompt’s Claude 3.5 models and Gemini 2.0 fallbacks are retired; Gemini 2.5 access is restricted for new projects. Defaults follow the current official [Gemini lifecycle page](https://ai.google.dev/gemini-api/docs/deprecations) and [Claude model overview](https://platform.claude.com/docs/en/models/overview). Model pools are centralized in `worker-ai.js`. Only a 429 triggers fallback. Exhaustion opens the browser’s one-tap provider switch; other failures remain errors. No paid caching is enabled. API usage is billed under your provider account; the app does not promise free AI or unlimited Cloudflare resources.

## Checks

Use Node 24 (Node 22.13+ supports the test SQLite API):

```sh
npm ci
npm run check
npm test
npm run build
```

Application code and tests have no npm runtime dependencies. Deployment uses Wrangler 4 through `npx`. `build.mjs` writes an allowlisted `dist/` containing only website assets. Never set the Pages upload directory to the repository root. All authored application files remain in the root; `.github/workflows/deploy.yml` is the only source subdirectory. `dist/`, `node_modules/` and `.wrangler/` are generated tooling directories and excluded from the source archive.

See `CHECKS.md` for verification evidence and remaining live checks. See `ARCHITECTURE.md` for security boundaries and endpoint behavior. This package was not deployed to your Cloudflare account, and no real API keys or live phone were used during testing.
