# Validation and audit closeout

Date: **9 October 2026**. Branch: `fix/digital-event-audit`.
Base revision: `9721522068761699c5dc9c0f2973e69fbafe3573`.

The earlier conversation history and complete transcript were recovered from
saved chat records, independently of their broken Linux workspace directories.
Native PowerShell execution and file read/write were verified before cloning.
Implementation, test data and credentials stayed in the Windows checkout and
its isolated local test stack. No PR, push, deployment or production database
operation was performed.

## Checks and results

| Check | Result |
| --- | --- |
| TypeScript (`npm run typecheck`) | Pass |
| Optimized Next.js build (`npm run build`) | Pass; all ten API routes are dynamic |
| Integrity suite (`npm test`) | Three tests pass, containing generation, chain, schema, permissions, attempt and rollback assertions |
| Development-server event simulation | Pass: 20 teams, all five stages, four finalists |
| Production-build event simulation | Pass: real local Supabase Auth, PostgreSQL, PostgREST, HTTP and Chromium |
| Dependency audit | Zero reported vulnerabilities after patching the test CLI's archive dependency |
| Browser-bundle credential scan | Pass: 16 bundles contain neither the isolated event secret nor service-role key |
| Whitespace/diff check | Pass |

The local stack uses the pinned Supabase CLI 2.54.11 and PostgreSQL 17.
CLI 2.120.0 failed during Windows database initialization; its fallback was
tested with an explicit local configuration. Chromium was installed under
the checkout's ignored `.dev/browsers` directory after its default cache
download failed. The runtime application does not depend on the test CLI.

The full simulation provisions 20 independent team Auth accounts and one
organizer. A pre-created account claims its name through the browser. All
teams solve sorting, mining, digital investigation and collision stages;
four leaders enter the finale. Browser controls are exercised for every
stage, with a separate finalist browser session submitting the finale and a
separate organizer browser scoring an explanation. Nineteen other-team
submissions run concurrently, and same-team races use simultaneous requests.

Assertions cover:

- Closed and expired stages, invalid sessions and non-admin controls.
- Private scores, inaccessible pool/secrets, revoked client audit inserts and
  denied direct calls to the service-only scoring function.
- Distinct, stable team puzzles, unambiguous sorting links, exactly one altered
  investigation block and solvable collision targets.
- One wrong-guess winner in a race, persistent reload lockout, three-guess
  exhaustion, Stage 3 lockout and scoring after the lock expires.
- Assigned mining challenge rejection for other teams and old rounds, invalid
  parents, unsuccessful proof cooldowns, accepted mining races and stable
  ranking timestamps after additional mining.
- Explicit nonce-cap removal and idempotent team claims preserving scores.
- Automatic collision awards, duplicate-success rejection and bounded judging.
- Four finalists selected from the ranked leaderboard; other teams cannot
  view or submit the finale. The API omits longest length and validity flags.
- A real fork: two children of one parent and a grandchild, yielding a
  three-block longest valid path. The display and scoring share one snapshot.
- One finale winner in a race, frozen data across close/reopen and blocked
  changes to finalist membership after freezing.
- Generated total equals the sum of all stage components; maximum is 670.
- Fresh schema installation, reapplication, legacy timestamp rename and repair
  when both old/new columns already exist, without losing existing rows.
- Repeated zero-hash IDs, false parents, orphan roots and cycles cannot inflate
  branch or longest-chain points. Selecting a duplicated valid line still
  earns the correct longest award.
- An injected audit-write failure rolls back score and cooldown changes in the
  same database transaction.
- Desktop and 390-pixel mobile layouts, including digital evidence tabs.

## Original engineering findings

| Finding | Resolution |
| --- | --- |
| 1. Unsupported SQL, non-repeatable policies, conflicting timestamp migration | Removed language statement; repeatable policy replacement; rename/merge before adding replacement; fresh/repeat/legacy database tests |
| 2. Fabricated audit submissions and transaction-hash obstruction | All client audit writes revoked; audit and score changes commit together; transaction stage replaced with collisions |
| 3. Repeated zero-hash blocks earn multiple branches | Reject repeated IDs within a path and require declared parent IDs; exploit regression |
| 4. Orphan roots and inconsistent longest validation | One structural validator for submitted paths and longest calculation; mining binds an existing owned parent or genesis |
| 5. Display/scoring use different pools | One server-only frozen finalist snapshot powers both APIs |
| 6. Calculator/submission normalization differs | Teaching inputs trim data and normalize previous hash; scored mining has server-assigned fields and a separate proof function |
| 7. Stage status becomes stale | Five-second stage/score polling plus authoritative server window checks |
| 8. Pre-created accounts cannot claim teams | Authenticated claim form and non-resetting idempotent team provisioning |
| 9. Public score table exposes private metadata | Underlying scores use own-team/admin RLS; public API explicitly projects scoreboard fields |
| 10. Empty nonce cap cannot clear old value | Browser sends null; transactional settings function removes the key |
| 11. Extra mining changes equal-score rank | Tie timestamp updates only when mining first adds points; rejected attempts and additional blocks leave it alone |

The further event-design findings are resolved by team-specific digital
puzzles, server-only keyed proofs and team-bound challenges, locked fork
access at both API and table layers, automatic collision scoring, and named
organizer judging. The public teaching hash remains deliberately weak.
Making the repository private is not relied upon as a security control.

## Evidence and practical limits

The final simulation summary and reviewed desktop/mobile screenshots are in
`docs/evidence/`. They contain only generated local test teams and puzzle
data. No Auth tokens, passwords, service keys or event secret are included.
The final production simulation passed in 38.2 seconds (33.9 seconds in the
test itself). Its winner scored 670, with stage totals 120, 180, 170, 50 and
150. Cleanup verification found zero team, audit and mining rows, with all
stages closed. Source hashes and the production build identifier are recorded
in `docs/evidence/source-manifest.json` for review.
The simulation deletes its temporary accounts and returns local stages to
closed defaults. Its local-only guard prevents remote database use.

The test harness reads the isolated event secret to find winning proof nonces
quickly; participants do not receive it. It waits for real mining cooldowns
and backdates a wrong-guess lockout only in the test database to keep the run
short. The programme's full 155 minutes is not spent waiting during automation.

No live production Supabase/Vercel environment, venue network, audience
projector distance, human puzzle pacing or production credential/ownership
transfer was tested. The local simulation validates the implemented flows and
permissions; it is not a promise that every deployment or event-day condition
will work. Run the documented human rehearsal and production setup checks
before the event. No leaderboard freeze or public solution-reveal feature was
added; organizers use the public scoreboard and reveal solutions after closing.
