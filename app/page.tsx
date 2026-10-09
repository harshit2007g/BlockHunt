import Link from "next/link";
import "./landing.css";

function BlockCard({
  num,
  hash,
  nonce,
  prev,
  active = false,
  dark = true,
}: {
  num: string;
  hash: string;
  nonce: string;
  prev: string;
  active?: boolean;
  dark?: boolean;
}) {
  return (
    <>
      <div
        className={`block-card${dark ? " dark-block" : ""}${active ? " active-block" : ""}`}
      >
        <div className="block-number">
          {num}
          {active ? " - active" : ""}
        </div>
        <div className="block-hash">{hash}</div>
        <div className="block-data">
          <span>nonce: {nonce}</span>
          <span className="divider-dot">·</span>
          <span>prev: {prev}</span>
        </div>
      </div>
      <div className="block-arrow">↓</div>
    </>
  );
}

export default function Home() {
  return (
    <>
      {/* ── NAV ── */}
      <nav className="nav">
        <Link href="/" className="nav-logo">
          Block<span>Hunt</span> &apos;26
        </Link>
        <ul className="nav-links">
          <li>
            <a href="#stages">Stages</a>
          </li>
          <li>
            <a href="#scoring">Scoring</a>
          </li>
          <li>
            <a href="#rules">Rules</a>
          </li>
          <li>
            <Link href="/leaderboard">Leaderboard</Link>
          </li>
          <li>
            <Link href="/forks">Fork Pool</Link>
          </li>
        </ul>
        <div className="nav-right">
          <Link href="/play" className="nav-cta">
            Team Login →
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-inner">
          <div>
            <p className="hero-eyebrow">
              Blockchain Division · Cyber Labs · IIT (ISM) Dhanbad · Event date
              announced at registration
            </p>
            <h1 className="hero-headline">
              Sort. Mine.
              <br />
              <span className="accent">Consensus.</span>
            </h1>
            <p className="hero-sub">
              This is the BlockHunt &apos;26 event platform. Log in with your
              team ID for the hash calculator and your stage submissions. Scores
              update live. The projector leaderboard is public. The Stage 5
              fork pool opens only to logged-in finalists during the finale.
            </p>
            <div className="hero-actions">
              <Link href="/play" className="btn-primary">
                Enter as a team →
              </Link>
              <Link href="/leaderboard" className="btn-secondary">
                Live leaderboard
              </Link>
              <Link href="/forks" className="btn-secondary">
                Fork pool
              </Link>
            </div>
            <div className="hero-hint">
              New here? You register through Unstop. Your team login is created
              at check-in on the day of the event.
            </div>
          </div>
          <div className="hero-visual">
            <div className="chain-viz">
              <BlockCard
                num="Block #001"
                hash="0041daaf"
                nonce="4821"
                prev="00000000"
              />
              <BlockCard
                num="Block #002"
                hash="039b20c5"
                nonce="7163"
                prev="0041daaf"
                active
                dark={false}
              />
              <BlockCard
                num="Block #003"
                hash="04755f1b"
                nonce="2940"
                prev="039b20c5"
              />
              <div
                className="block-card"
                style={{
                  borderStyle: "dashed",
                  opacity: 0.5,
                  textAlign: "center",
                }}
              >
                <div className="block-number" style={{ margin: 0 }}>
                  Mine to extend the chain…
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── QUICK LINKS BAND ── */}
      <section className="quick-band">
        <div className="container">
          <div className="quick-grid">
            <Link href="/play" className="quick-card">
              <div className="quick-title">Team Console</div>
              <div className="quick-desc">
                Log in for the hash calculator and stage answers. Your
                submission history is here as well.
              </div>
              <div className="quick-go">Open /play →</div>
            </Link>
            <Link href="/leaderboard" className="quick-card">
              <div className="quick-title">Live Leaderboard</div>
              <div className="quick-desc">
                The projector view. Scores update in real time as teams submit.
                Ties go to the team that reached its score first.
              </div>
              <div className="quick-go">Open /leaderboard →</div>
            </Link>
            <Link href="/forks" className="quick-card">
              <div className="quick-title">Fork Pool</div>
              <div className="quick-desc">
                Logged-in finalists inspect a frozen pool while Stage 5 is
                open. Verify the blocks and reconstruct valid branches.
              </div>
              <div className="quick-go">Open /forks →</div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── STAGES ── */}
      <section className="stages-section" id="stages">
        <div className="container">
          <p className="section-eyebrow">Five Stages</p>
          <h2 className="section-headline">From warm-up to fork resolution</h2>
          <p className="section-sub">
            Each stage is a live task. You show what you understand by doing it,
            and the difficulty climbs as you go. Stages unlock from your team
            console as the organizers open them.
          </p>
          <div className="stages-grid">
            <div className="stage-card dark-stage">
              <div className="stage-header">
                <span className="stage-num">Stage 1</span>
                <span className="stage-badge">15 min</span>
              </div>
              <h3 className="stage-title">Sort the Chain</h3>
              <p className="stage-desc">
                You get six shuffled digital blocks unique to your team. Follow
                previous hashes from genesis and use the teaching calculator to
                verify the fields. Submit each label once in chain order. Three
                guesses max, with a 60-second lockout after a wrong attempt.
              </p>
              <div className="stage-meta">
                <span className="stage-points">
                  100 pts + up to 20 speed bonus
                </span>
              </div>
            </div>

            <div className="stage-card">
              <div className="stage-header">
                <span className="stage-num">Stage 2</span>
                <span className="stage-badge">35-45 min</span>
              </div>
              <h3 className="stage-title">Mine to Match</h3>
              <p className="stage-desc">
                Try nonces against a team-bound server challenge. Every proof
                attempt shares a three-second team cooldown, including attempts
                from multiple tabs. Your first accepted block scores; keep
                extending or forking your own blocks to build the finale pool.
                The teaching calculator cannot compute mining proofs.
              </p>
              <div className="stage-meta">
                <span className="stage-points">
                  150 pts + up to 30 speed bonus
                </span>
              </div>
            </div>

            <div className="stage-card dark-stage">
              <div className="stage-header">
                <span className="stage-num">Stage 3</span>
                <span className="stage-badge">30 min</span>
              </div>
              <h3 className="stage-title">Catch the Forger</h3>
              <p className="stage-desc">
                Two six-block chains appear in your team console. Split the
                data, hash and link tabs among teammates, cross-check with the
                teaching calculator, identify the changed block and explain the
                evidence. All investigation material is digital.
              </p>
              <div className="stage-meta">
                <span className="stage-points">
                  130 + 20 explanation + up to 20 speed
                </span>
              </div>
            </div>

            <div className="stage-card bonus-stage">
              <div className="stage-header">
                <span className="stage-num">Stage 4</span>
                <span className="stage-badge bonus">Optional Bonus</span>
              </div>
              <h3 className="stage-title">Collision Hunt</h3>
              <p className="stage-desc">
                Find two different nonces that produce your assigned target
                teaching hash with fixed data. Discover why nonce digit sums
                collide and how weak hashes can break a contract condition.
                Success automatically awards 50 points; no wallet or transaction
                is needed.
              </p>
              <div className="stage-meta">
                <span className="stage-points">+50 flat on success</span>
                <span className="stage-time">· no time component</span>
              </div>
            </div>

            <div className="stage-card dark-stage">
              <div className="stage-header">
                <span className="stage-num">Stage 5</span>
                <span className="stage-badge">Finalists only</span>
              </div>
              <h3 className="stage-title">Consensus Finale</h3>
              <p className="stage-desc">
                Finalists receive a frozen pool containing their accepted Stage
                2 blocks. Roots share the genesis convention, and teams can fork
                by mining different children of their own earlier blocks. Verify
                hashes and parent IDs, reconstruct distinct paths and choose a
                longest valid chain.
              </p>
              <div className="stage-meta">
                <span className="stage-points">
                  10 pts/branch (max 50) + 100 for longest
                </span>
                <span className="stage-time">· 20-25 min</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SCORING ── */}
      <section className="scoring-section" id="scoring">
        <div className="container">
          <p className="section-eyebrow">Marking Scheme</p>
          <h2 className="section-headline">Base points plus speed bonuses.</h2>
          <p className="section-sub">
            Each stage pays a base score for a correct solution, plus a speed
            bonus scaled to the time you have left. Ties go to the team that
            reached its score first.
          </p>
          <div className="scoring-grid">
            <div className="score-card featured-score">
              <div className="score-stage">Stage 1</div>
              <div className="score-name">Sort the Chain</div>
              <div className="score-pts">120</div>
              <div className="score-note">
                100 base <span className="score-bonus">+ up to 20</span> speed.
                0 pts if unsolved after 3 guesses. 60s lockout between wrong
                attempts.
              </div>
            </div>
            <div className="score-card">
              <div className="score-stage">Stage 2</div>
              <div className="score-name">Mine to Match</div>
              <div className="score-pts">180</div>
              <div className="score-note">
                150 base <span className="score-bonus">+ up to 30</span> speed.
                One nonce attempt per 3 seconds.
              </div>
            </div>
            <div className="score-card featured-score">
              <div className="score-stage">Stage 3</div>
              <div className="score-name">Catch the Forger</div>
              <div className="score-pts">170</div>
              <div className="score-note">
                130 correct block ID + 20 explanation quality{" "}
                <span className="score-bonus">+ up to 20</span> speed. Rubric:
                accuracy, clarity, correct hash check.
              </div>
            </div>
            <div className="score-card">
              <div className="score-stage">Stage 4 · Optional</div>
              <div className="score-name">Collision Hunt</div>
              <div className="score-pts">+50</div>
              <div className="score-note">
                Flat <span className="score-bonus">50 pts</span> on success. No
                time component, and skipping it costs you nothing.
              </div>
            </div>
            <div className="score-card featured-score">
              <div className="score-stage">Stage 5 · Finalists</div>
              <div className="score-name">Consensus Finale</div>
              <div className="score-pts">150</div>
              <div className="score-note">
                <span className="score-bonus">10 pts</span> per valid branch
                (max 50) <span className="score-bonus">+ 100</span> for the
                longest branch.
              </div>
            </div>
            <div
              className="score-card"
              style={{
                border: "1px solid var(--mute)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: "var(--sp-sm)",
              }}
            >
              <div className="score-stage">Tiebreaker</div>
              <div className="score-name">Earliest timestamp</div>
              <div className="score-note">
                Same total score? The team that reached it first ranks higher.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── RULES ── */}
      <section className="rules-section band-dark" id="rules">
        <div className="container">
          <p className="section-eyebrow">Rulebook</p>
          <h2 className="section-headline">What you need to know</h2>
          <p className="section-sub">
            These are the rules that get teams disqualified. The full rulebook
            is available in the team console and event guide.
          </p>
          <div className="rules-cols">
            <div>
              <p className="rules-group-title">AI &amp; Tools</p>
              {[
                "AI assistants are allowed for general reference. Every stage still requires live, rate-limited interaction with the puzzle tools by a person at the keyboard.",
                "Scripting, automating, or bulk-querying the hash calculator or the submission endpoints is a rules violation and can mean disqualification.",
              ].map((t, i) => (
                <div className="rule-item" key={t.slice(0, 16)}>
                  <div className={`rule-dot${i === 1 ? " warn" : ""}`} />
                  <p className="rule-text">{t}</p>
                </div>
              ))}
              <p
                className="rules-group-title"
                style={{ marginTop: "var(--sp-2xl)" }}
              >
                Fair Play
              </p>
              {[
                "Sharing block data, hashes, or answers between teams is strictly prohibited and leads to disqualification of all teams involved.",
                "Stage 3 evidence is unique to each team and appears only while the stage is open.",
                "Teams may not interfere with, view, or attempt to access another team's session on the event platform.",
              ].map((t) => (
                <div className="rule-item" key={t.slice(0, 16)}>
                  <div className="rule-dot warn" />
                  <p className="rule-text">{t}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="rules-group-title">Stage-Specific</p>
              {[
                "Stage 1: 3 guesses max, 60-second lockout between wrong attempts.",
                "Stage 2: backend enforces one nonce attempt every 3 seconds per team.",
                "Stage 4 is optional, and skipping it doesn't affect your base score.",
                "Stage 5 is open only to the top 4-6 teams after Stage 3 plus any Stage 4 bonus.",
              ].map((t) => (
                <div className="rule-item" key={t.slice(0, 16)}>
                  <div className="rule-dot" />
                  <p className="rule-text">{t}</p>
                </div>
              ))}
              <p
                className="rules-group-title"
                style={{ marginTop: "var(--sp-2xl)" }}
              >
                Judging &amp; Disputes
              </p>
              {[
                "Decisions from judges and volunteers on completion, timing, and rubric scores are final.",
                "Raise any dispute with a volunteer or judge at the relevant stage table before moving to the next stage.",
              ].map((t) => (
                <div className="rule-item" key={t.slice(0, 16)}>
                  <div className="rule-dot" />
                  <p className="rule-text">{t}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA BAND ── */}
      <section className="cta-band" id="enter">
        <p className="cta-eyebrow">Stages are live</p>
        <h2 className="cta-headline">Open your team console.</h2>
        <p className="cta-sub">
          Log in with your team account, keep the hash calculator close, and
          watch the fork pool for the longest branch.
        </p>
        <div className="cta-actions">
          <Link href="/play" className="btn-primary">
            Team Login →
          </Link>
          <Link href="/leaderboard" className="btn-secondary">
            Leaderboard
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            Block<span>Hunt</span> &apos;26
          </div>
          <ul className="footer-links">
            <li>
              <a href="#stages">Stages</a>
            </li>
            <li>
              <a href="#scoring">Scoring</a>
            </li>
            <li>
              <a href="#rules">Rules</a>
            </li>
            <li>
              <Link href="/leaderboard">Leaderboard</Link>
            </li>
            <li>
              <Link href="/forks">Fork Pool</Link>
            </li>
            <li>
              <Link href="/play">Team Login</Link>
            </li>
          </ul>
        </div>
      </footer>
    </>
  );
}
