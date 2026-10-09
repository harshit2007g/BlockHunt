# BlockHunt '26

A digital five-stage blockchain puzzle event for teams of 2–3. Next.js App
Router, Supabase Auth and PostgreSQL provide the team console, persistent
attempt limits, transactional scoring and organizer controls.

| Route | Audience and purpose |
| --- | --- |
| `/` | Public event overview and rules |
| `/play` | Team login/claim, teaching calculator and all five digital stages |
| `/leaderboard` | Public totals and stage points, refreshes every five seconds |
| `/forks` | Frozen pool, only for logged-in finalists during Stage 5 |
| `/admin` | Organizer login, stage controls, difficulty, finalists and judging |

Read [the event guide](docs/EVENT_GUIDE.md) for the 155-minute programme,
participant instructions, scoring, judge rubric and event-day checklist.
Read [validation](docs/VALIDATION.md) for tested behavior and limitations.

## Changes from the earlier event design

- Stage 1 has six shuffled blocks and a separate deterministic instance per
  team; no default answer is supplied.
- Stage 3 replaces physical cards with two digital six-block chains and data,
  hash and link tabs. The altered block varies by team. No printing is needed.
- Stage 2 uses assigned, team-bound HMAC-SHA256 proof challenges, evaluated
  exclusively on the server. The public toy calculator remains available for
  learning, investigation, collisions and finale verification.
- Stage 4 is a collision hunt with automatic validation and a 50-point award.
  It requires no Sepolia wallet, contract, transaction hash or manual approval.
- The finalist pool is frozen once. Direct table reads are revoked and the
  authenticated API supplies blocks without a computed solution or validity
  hints. Chain scoring verifies unique IDs, declared parents and genesis.
- A database transaction serializes every team's submissions and atomically
  writes scores, attempts, mining blocks and audit rows. No state is held in
  server memory. Extra mining and wrong guesses do not move ranking ties.
- Admins judge named teams from the website. Non-admins cannot invoke controls
  or scoring functions. Scores/audit rows are private to the owning team and
  admins; the leaderboard API supplies an explicit public projection.

## Install and configure

Use Node.js 24 and the committed lockfile:

```powershell
npm ci
Copy-Item .env.example .env.local
```

Set the Supabase URL, anon key and server-only service-role key in
`.env.local`. Generate `EVENT_SECRET` with at least 32 random characters
(for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
Keep it stable through the event and never expose it in a `NEXT_PUBLIC_` variable.
Do not give organizer credentials or the event secret to competitors.

Apply `supabase/schema.sql` followed by `supabase/event.sql` within one
transaction in the dedicated event database. Both are re-runnable and preserve
existing data. Take a backup before upgrading. The schema repairs legacy
`stage2_last_nonce` timestamps, including partially migrated installations.
Existing invalid/unlinked pool blocks remain stored but cannot score a valid
path. For a new event, use a fresh dedicated database so rehearsal rows cannot
affect scores; do not reset a running event.

Pre-create one confirmed Auth account per registered team. Teams claim a
unique name on their first logged-in visit. Disable open signup on event day.
Create an organizer Auth account and insert its user ID in `admin_users`.
Admin access exposes team evidence and is unsuitable for a competing account.
Run `npm run dev` and open `http://localhost:3000`.

Opening a stage starts its fixed-duration clock once. Closing and reopening
does not pause or restart it. Expired stages reject submissions automatically.
Close Stage 2 and set finalists before opening Stage 5; opening freezes the
pool and prevents further finalist edits. Documentation describes the
server's enforced rules, not assumed browser restrictions.

## Isolated tests on Windows

The committed local Supabase configuration uses project ID `BlockHunt`, API
`127.0.0.1:54321` and PostgreSQL `127.0.0.1:54322`. Do not link it to a
remote project. Reserve this local stack for tests; the event simulation
deletes its local teams/pool and creates temporary Auth users. It refuses
remote URLs and uses the specifically named local database container.

Start Docker Desktop, then:

```powershell
npx supabase start
npm run test:setup
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.dev/browsers'
npx playwright install chromium
npm test
$env:EVENT_E2E = '1'
npm run test:e2e
Remove-Item Env:EVENT_E2E
npm run typecheck
npm run build
```

`test:setup` applies both SQL files to the local container and writes local
test keys to ignored `.env.local`. It refuses to overwrite non-local config.
The pinned test CLI avoids a Windows database-initialization failure seen in
2.120.0. Its archive dependency is overridden to a patched release; no CLI
dependency is used by the production application.

The end-to-end test launches the website, exercises real local Supabase Auth,
solves a full 20-team event, selects four finalists, submits a forked finale,
and checks permission boundaries, reloads, expiry and concurrent requests.
It uses the secret only inside its test harness to select winning nonces;
the production/browser team flow never receives that secret. Waiting periods
are preserved for mining concurrency checks. One wrong-guess lockout is
backdated in the isolated test DB to avoid a minute of idle test time.

Artifacts appear in ignored `test-results/`, including screenshots and
`event-summary.json`. Test accounts are deleted on completion, including
failed tests. To stop this local stack, use `npx supabase stop` (keeps its
data). To clear only its rehearsal database, rerun the explicitly local
simulation; for production use a separate fresh project and check-in roster.

No PR, deployment or production database operation is performed by these
tests or by the implementation branch. Deployment/ownership transfer remains
a separate organizer action after review. Rotate privileged credentials when
ownership changes and update all server environments together.
