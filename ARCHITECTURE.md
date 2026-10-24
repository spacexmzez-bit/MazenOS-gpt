# Architecture and contracts

## Storage and trust

Cloudflare Pages serves public application assets, never records or credentials. All records require a valid browser bearer at the Worker. Data is in one D1 binding, `DB`. `TEMP` is the KV binding for expiring media decisions. Only secrets `SETUP_TOKEN` and `VAULT_KEY` live in Worker configuration. Provider keys are AES-256-GCM encrypted in D1 with a fresh IV each time. VAULT_KEY is 32 random bytes encoded as 64 hex characters. Do not replace it without first replacing or removing both saved provider keys.

The password is salted and PBKDF2-SHA256 derived at 100,000 iterations, compatible with Workers Web Crypto. Browser bearers are random 256-bit values, stored in sessionStorage; only their SHA-256 hashes persist in D1. Sessions expire after seven days; no idle extension is implemented. Logging out deletes the current session immediately. Changing a password revokes every browser session and returns one replacement session to that browser. The independent phone token is rotated/revoked separately. Password loss requires an operator reset, described in SETUP.html.

The phone token is shown once and stored hashed. It can access only GET /status, POST /api/budget/sms, POST /api/audit/media and POST /api/health/sync. Never put any bearer in a URL. CORS accepts exact configured origins. Requests from native clients without Origin still require bearer authentication. D1 counters rate-limit login, owner, phone and AI requests atomically. Unknown fields are not copied into database updates.

## Routes

| Route family | Purpose |
|---|---|
| `/api/auth/setup`, `/api/auth/login` | Only public writes; setup is one-time and requires the server setup code |
| `/api/auth/logout`, `/api/auth/password` | Session revocation and password-confirmed password changes |
| `/api/settings`, `/api/settings/keys`, `/api/settings/phone` | Shared preferences, password-confirmed key changes and phone credentials; no raw-key read endpoint |
| `/api/tasks`, `/api/tasks/:id` | List, create and version-checked edits |
| `/api/tasks/:id/complete`, `/bonus`, `/archive`, `/subtasks` | Server-validated task actions |
| `/api/audit/proof` | JPG/PNG/WebP/PDF, at most 5 MiB binary; exact criteria; provider response schema; task/version recheck; receipt and completion in a D1 batch |
| `/api/focus`, `/api/focus/stop`, `/api/focus/reminder` | Persisted timers, cancellation and reminder acknowledgement |
| `/api/chat`, `/api/chat/sessions`, `/api/chat/history`, `/api/chat/branch` | Full saved conversations; provider context capped at six messages; history pages of 500 messages |
| `/api/health`, `/api/health/medicine`, `/api/health/sick` | Health logs, atomic dose counter and sickness transitions |
| `/api/curry`, `/api/curry/import`, `/api/curry/plan`, `/api/curry/:id/drill` | Syllabus, day allocation and confirmed spaced-recall tasks |
| `/api/locations`, `/api/locations/:id/items`, `/api/locations/:id/commute` | Locations, pricing and deterministic round-trip gate |
| `/api/ideas/capture`, `/draft`, `/seal` | One server-issued three-minute write window; drafts autosave; deadline checked on every write |
| `/api/ideas`, `/api/ideas/:id`, `/api/ideas/synthesize`, `/api/ideas/synthesized` | Focus-restricted reading/editing/deletion, Friday synthesis and acknowledgement |
| `/api/diary`, `/api/budget`, `/api/leisure`, `/api/export`, `/api/summary` | Dedicated tools, export and dashboard state |

All writes use JSON. IDs are opaque. UI labels do not expose hashes, token counters, raw model payloads or internal session IDs. Error details from provider response bodies are not sent to users or logged. Workers logs record only a generic exception name for unexpected failures.

## Time and scheduling

Display dates/times are Asia/Riyadh (UTC+03, no DST). User date/time inputs are explicitly interpreted in Riyadh time regardless of the browser time zone. Stored task timestamps are canonical UTC ISO strings. Health days roll over at 03:00 Riyadh, corresponding to 00:00 UTC. Friday protection follows the Riyadh calendar date. Cron `0 0 * * *` is interpreted by Cloudflare in UTC.

Overdue P1 tasks lock the device outside recovery, rest windows, leisure windows and Fridays. Bonuses are exempt from overdue locks. Dependency rebalancing runs when tasks are read/saved, status is polled and the daily cron executes. Independent tasks remain unchanged. Each child keeps its scheduled gap from its prerequisite (at least its own duration) after the active parent's effective due time (or now if overdue); old later deadlines are not pulled earlier.

Sickness pauses academic P1 roots and intense tasks and their active dependent chains, remembers each task's priority and pause start, and cancels focus on paused tasks. Ending sickness restores priorities and adds the paused interval to due times. New relevant tasks added during illness are also paused. Bonus tasks retain the exact original future timestamp; unfinished bonuses return on the next daily cron. Completed bonuses stay completed. Counter initialization is idempotent so repeated cron delivery never resets doses already logged for the new day.

Completed focus timers are reconciled from stored timestamps; the page does not have to stay open. Stopped sessions are excluded from continuous-work reminders. Gaps over ten minutes break the continuous run. A break banner requires an open app page; it is not a background push notification.

## Deliberate boundaries

- NewPipe integration checks the title, not playback completion or actual video contents. Temporary checks expire after one hour and bind to the task version. Irrelevant media sets a 15-minute KV flag. Service failure never creates a valid video check.
- Proof files pass through the Worker to the provider and are not persisted by this app. Provider retention policies still apply. Only audit results are stored. Vision models can make mistakes and cannot supply tamper-proof physical verification.
- Idea captures autosave every 1.5 seconds while connected. At expiry only the last draft received by the server is retained; a disconnected tab cannot guarantee the final unsent keystrokes. Expired drafts are sealed lazily on the next idea request. Reopening the UI never extends the issued deadline.
- Chat actions are task proposals requiring a click. No model response can directly complete a task, reveal a key, delete data or change the phone credential.
- Diary formatting stores Markdown for bold/italic plus allowlisted alignment/font-size fields. Display escapes HTML before rendering the two Markdown styles. It never inserts user HTML.
- Bank regex recognizes documented common SAR card-credit/debit alerts, not every Saudi bank format. Ambiguous/unknown messages return 422 without altering the ledger. It never calls AI for SMS. Duplicate detection uses a stable message ID when supplied; otherwise exact SMS text is hashed. Raw SMS and OTPs are not stored.
- Wallet amounts are signed: expenses negative, income positive. A known balance anchors subsequent entries; without a known opening balance, the display is the sum of recorded entries. Bank alert delays can still require a manual correction.
- The settings export contains all user records but no sessions, password hashes, phone tokens, vault ciphertext or API keys. A bulk restore/import UI and legacy Taskitator migration are not included. Use D1 backups for full restoration.

This is a single-user personal app, not a multi-tenant service. Add per-user ownership, managed identity and a different account lifecycle before inviting other users. Do not reuse its D1 database for the old Taskitator Worker.
