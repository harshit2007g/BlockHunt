# BlockHunt '26: Event Platform

The live platform for the BlockHunt '26 blockchain puzzle hunt (Blockchain Division, Cyber Labs, IIT ISM Dhanbad).

| Route         | What it is                                                          |
| ------------- | ------------------------------------------------------------------- |
| `/`           | Event-day landing page (same design theme as the original)          |
| `/play`       | Team console: login, hash calculator, Stage 1-4 submissions         |
| `/leaderboard`| Public projector view, auto-refreshes every 5s                      |
| `/forks`      | Public Stage 5 fork-pool visualization (all mined blocks + branches)|
| `/admin`      | Organizer controls: open/close stages, set Stage 3 tampered block   |

## Stack

- **Next.js 16 + TypeScript** (App Router), deployed on **Vercel**
- **Supabase** (Postgres + Auth + Row-Level Security). It was chosen because project
  ownership transfers cleanly between accounts (Settings → General → Transfer
  Project) and RLS makes team data private by construction

## Why an organizer can compete without seeing other teams' data

- `raw_submissions` RLS: a team can only read rows where `team_id = my_team_id()`.
- Teams never see other teams' raw answers, nonces, or explanations.
- The **service-role key** (full access) lives only in Vercel env vars, owned by
  the *organizer account*. Before transferring, rotate it so the old owner's
  copy stops working.
- The leaderboard exposes only computed totals, which are public anyway.

## Setup

1. **Supabase**: create a project → SQL Editor → paste `supabase/schema.sql` → run.
    If you ran an earlier version of the schema, run it again. The file is
    idempotent (`drop if exists` / `create or replace` / `add column if not
    exists`) and the migration block at the bottom upgrades existing
    databases in place: adds `mining_pool.data`, renames
    `scores.stage2_last_nonce` to `scores.stage2_last_attempt_at`, adds
    `stage3_attempts`, `stage3_locked_until`, `stage4_submitted_at`,
    `stage4_tx_hash`, creates `stage_secrets` and moves the Stage 3/4 answers
    out of `stage_config` into it, seeds the Stage 5 `finalists` list, and
    drops the removed client-write policies.
    Existing pool rows keep `data = ''` and `parent_block = NULL`; they stay
    readable but sit at depth 1 until teams mine new linked blocks.
2. Create the organizer user: Auth → Users → Add user (e.g. `org@cyberlabs.in`).
   Then in SQL Editor: `insert into admin_users (user_id) select id from auth.users where email = 'org@cyberlabs.in';`
3. Team accounts: either enable open signups in Auth settings, or pre-create
   each team's login the same way (teams claim their name on first /play visit).
4. **Vercel**: import the repo → add env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
5. Deploy. Done.

## Event-day ops (from `/admin`)

- Auth checklist (do this before doors open):
  - Supabase Dashboard → Auth → Providers → Email → disable "Confirm email".
    If confirmation stays on, new signups get no session and `/play` shows
    "check your inbox, then log in".
  - Pre-create one account per Unstop team (Auth → Users → Add user) and hand
    out credentials at check-in. Open signups should stay disabled on the day.
  - Collect member rosters at check-in (paper or form) and match each login
    to one Unstop team. One account per team keeps Sybil entries out; no
    roster feature is built into the app, the check-in sheet is the control.
- Open a stage right as it starts. Opening stamps `started_at`, which drives
  every speed-bonus calculation. Opening again restarts the clock, so the
  admin UI asks for confirmation first.
- Stage 3: set the tampered block number in the admin settings panel before
  opening. Teams get 3 guesses with a 60s lockout after each wrong guess.
  The answer lives in `stage_secrets` (service-role only); `stage_config`
  rows are readable by every logged-in team, so never put answers there.
- Stage 2: difficulty target (`difficulty_prefix`), nonce cap (`nonce_max`),
  and window length live in `stage_config`. Adjust in `/admin` if the room
  pace needs it. The API rejects nonces at or above `nonce_max`.
- Stage 4: optional bonus, no time component. Teams submit a tx hash once
  (repeats get 409, reused hashes are rejected). The submission sits pending
  until the coordinator confirms the winning tx hashes, then sets
  `scores.stage4_bonus = 50` in the Supabase table editor.
- Stage 5: finalists only (top 4 to 6 teams after Stage 3 and Stage 4, ties
  break to the earliest final submission). Paste the finalist team names into
  the admin panel before opening; non-finalists get 403. Scoring is
  10 pts per unique valid branch (max 50) plus 100 for naming the longest
  valid chain. Duplicate branches dedupe by sorted-id signature, and the
  longest pick must itself re-verify against the pool hash chain.
- Stage 3 explanation quality: set `scores.stage3_expl` (0-20) per judge rubric.

## Transferring ownership after the event

1. Vercel: Team Settings → transfer project or invite the new owner as Owner.
2. Supabase: Settings → General → Transfer Project → enter the new owner's
   account email; they accept from their dashboard.
3. **Rotate `SUPABASE_SERVICE_ROLE_KEY`** after transfer so the previous
   owner's env copy is dead (Supabase → Settings → API → regenerate).
4. GitHub: Settings → transfer repository, if you want the code to move too.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in the three Supabase vars
npm run dev
```
