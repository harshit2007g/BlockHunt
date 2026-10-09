# BlockHunt digital event guide

Teams of 2–3 share one pre-created account. All puzzle material is in `/play`;
no printed cards, wallet, testnet funds or external contract are needed.
AI reference tools are allowed, but answer sharing and automated bulk requests
violate the event rules. The website does not claim to detect human clicks or
prevent AI from understanding a puzzle.

## Suggested 155-minute programme

| Activity | Minutes | What participants do |
| --- | ---: | --- |
| Check-in and briefing | 15 | Log in, claim registered team name, learn the teaching calculator |
| Stage 1: Sort the Chain | 15 | Reconstruct six shuffled blocks from genesis |
| Stage 2: Mine to Match | 40 | Try server proofs, extend chains, create forks |
| Stage 3: Catch the Forger | 30 | Investigate two digital six-block chains and explain the alteration |
| Stage 4: Collision Hunt | 20 | Optional collision discovery, followed by discussion of weak hashes |
| Stage 5: Consensus Finale | 25 | Four to six finalists inspect the frozen pool and reconstruct valid paths |
| Reveal and prizes | 10 | Explain proofs, tamper evidence, collisions and consensus |

The Stage 4 exercise can be solved quickly by noticing equal digit sums.
Use its remaining time for demonstrations and discussion. Rehearse pacing with
beginners and experienced participants; the application cannot guarantee a
particular solve time. The 40-minute mining window uses equal difficulty for
all teams. A one-character proof prefix averages 16 attempts (roughly 48
seconds at the cooldown); two characters average 256 (roughly 13 minutes).
These are statistical means, not deadlines. The stage involves building and
forking multiple blocks, not waiting 40 minutes for a single answer.

## Teaching calculator

Use the public toy hash for Stages 1, 3, 4 and finale verification. It returns
eight hexadecimal characters and deliberately has weak collision properties.
Inputs are normalized by trimming data and lowercasing/trimming previous hash.
Nonce must be an integer in `0..1,000,000,000`. It is an educational function,
not a secure hash or cryptocurrency implementation.

Stage 2 uses a separate server-only HMAC-SHA256 proof keyed by `EVENT_SECRET`.
The teaching calculator cannot compute that proof. Each mining challenge binds
team ID, current round, parent ID and previous hash; data is assigned by the
server. Every scored calculation is a submission to the same endpoint and
shares the persistent three-second cooldown for that team, across tabs/devices.
Publishing the source does not expose the HMAC key. Keep the event secret and
service-role credentials confidential and stable throughout an event.

## Participant flow and scoring

1. **Sort:** Start at previous hash `00000000`, find the next linked block and
   submit every label exactly once. Labels and data vary by team, and the answer
   starts blank. Maximum three guesses; each wrong guess locks the team for
   60 seconds. Award: 100 plus up to 20 speed points.
2. **Mine:** Choose genesis or one of your accepted blocks as parent. Try a
   nonce against the assigned challenge. Failed proofs consume cooldowns too.
   Acceptance creates a block with a verifiable teaching hash and advances the
   round. Copying another team's challenge or replaying an old round fails.
   First accepted block: 150 plus up to 30 speed points. Further accepted
   blocks build the pool without changing points or the score tie timestamp.
   To fork, mine two different children of the same earlier block. Roots all
   follow the common virtual genesis convention; parent ownership is restricted
   to the same team so excluding non-finalists cannot strand their ancestors.
3. **Investigate:** Open the data, hashes and links tabs. Divide these views
   among teammates and compare both chains using the teaching calculator.
   Exactly one block's data was changed without updating its recorded hash.
   Identify its label and explain the recomputed mismatch and downstream
   implications in 30–5120 characters. Three guesses, with the same persistent
   60-second wrong-guess lockout. Award: 130 plus up to 20 speed points and up
   to 20 judge points. Data stays on the website; tab separation encourages
   collaboration and is not a security boundary.
4. **Collision:** With the assigned fixed data and genesis previous hash,
   submit two distinct nonces from `0..9999` that both produce your target toy
   hash. Think about nonce digit sums. Maximum one submission attempt every
   three seconds; success automatically awards 50 once. Optional and no speed
   points. No transaction hashes or manual confirmations remain.
5. **Finale:** After judging and the optional bonus, rank teams by total, then
   earlier last *scoring* submission timestamp. Choose four to six finalists
   in `/admin`. Close mining before opening Stage 5. Opening freezes their
   exact block pool server-side; non-finalists and logged-out users cannot
   read it, including through direct database access. No longest count, valid
   flag, pre-grouped branch tree or recomputed answer appears in `/forks`.
   Submit one or more ordered paths starting at genesis. Each ID can appear
   only once in a path, each teaching hash must recompute, and declared parent
   IDs and previous hashes must agree. Distinct valid paths earn 10 each,
   capped at 50; a longest valid selected path earns 100. Duplicate identical
   paths deduplicate, including when the selected longest line is a duplicate.
   There is one atomic finale submission. Display and scoring use the same
   frozen finalist pool. Closing and reopening cannot change that pool or its
   finalist list.

Maximum total: **670** (120 + 180 + 170 + 50 + 150).
Speed points decrease linearly from the first opening, rounded to the nearest
integer and clamped to the configured window. Wrong attempts never move the
tie timestamp. Rubric edits do not change the team's submission timestamp.
All stages expire at their configured duration even if an organizer forgets to
close them. Closing/reopening preserves the first start time; it is not a pause
or a restart. Explain that rule before starting.

## Organizer checklist

- Set the actual event date on your registration announcement; the site does
  not assume the earlier unverified 9 October date.
- Use a dedicated event database. Run a rehearsal against a separate local or
  dedicated test project. Do not point the simulation at production.
- Apply `schema.sql` then `event.sql` in one transaction; take a backup before
  an existing installation is upgraded. Old invalid/unlinked pool rows are
  preserved but fail structural verification. A fresh event database is the
  cleanest choice for a new run; never reset a live event to clear rehearsal data.
- Pre-create accounts, disable open signup on event day, verify confirmation
  settings, and record the team roster at check-in. Each authenticated account
  can claim one unique name; `/play` shows the claim form when needed.
- Confirm `EVENT_SECRET` is a random secret with at least 32 characters. Changing
  it mid-event changes puzzles and invalidates challenges. Never put it in a
  `NEXT_PUBLIC_` variable. Keep organizer credentials separate from team accounts.
  Administrators can see other teams' evidence; competitors must not hold
  administrator/service credentials or the event secret.
- Rehearse difficulty and Wi-Fi latency, keep a backup projector, and test the
  managed Supabase project shortly before doors open. Verify it is available.
- Open stages from `/admin`. Stage 3 answers are generated per team; there is
  no organizer-entered global tampered-block answer to distribute or print.
- Judge explanations from the named-team form in `/admin`: 0 no evidence;
  5 identifies mismatch; 10 correct recalculation; 15 explains continuity;
  20 clear evidence plus downstream impact. Points must be 0–20 and the team
  must have solved Stage 3. No Supabase table-editor scoring is needed.
- Difficulty prefix supports one or two hex characters. Clearing the nonce-cap
  input explicitly removes the previous cap. Existing challenged attempts are
  checked again against current database settings at commit time.
- Close Stage 2; select finalists from the leaderboard after judging. Ensure
  finalists built useful branches before opening Stage 5. The pool is frozen
  once; finalists cannot be edited afterward. `/leaderboard` is the public
  projector surface; `/forks` is the finalist investigation surface.
- Reveal solutions verbally/on the projector after closing the finale. The
  app deliberately does not publish a precomputed longest-chain answer.

## Isolation and evidence

`npm test` checks puzzle/chain logic and executes fresh, repeated and legacy
schema upgrades in an embedded PostgreSQL test database. `npm run test:e2e`
requires `EVENT_E2E=1`, an explicitly local Supabase URL, the task's local
database container, and installed Chromium. It runs real Auth, HTTP routes,
database transactions, permissions and browser interactions; there are no
mock scoring tables. See README for setup and `VALIDATION.md` for observed
results and practical limits. A successful automated simulation does not prove
human pacing, venue connectivity or every possible production condition.
