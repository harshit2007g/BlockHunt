"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser, type Team, type Scores } from "@/lib/supabase";
import { blockHash } from "@/lib/hash";

type Tab = "calc" | "s1" | "s2" | "s3" | "s4" | "s5";

type StageMap = Record<string, { open: boolean; difficulty_prefix?: string }>;

const sb = () => supabaseBrowser();

function sessionToken(
  sess: { session?: { access_token: string } | null } | null,
): string | null {
  return sess?.session?.access_token ?? null;
}

export default function PlayPage() {
  const [authUid, setAuthUid] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [score, setScore] = useState<Scores | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [teamName, setTeamName] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [tab, setTab] = useState<Tab>("calc");
  const [booting, setBooting] = useState(true);
  const [stages, setStages] = useState<StageMap>({});

  const refresh = useCallback(async () => {
    const { data: sess } = await sb().auth.getSession();
    const uid = sess.session?.user.id ?? null;
    setAuthUid(uid);
    if (!uid) {
      setTeam(null);
      setScore(null);
      return;
    }
    const token = sessionToken(sess);
    if (!token) {
      setAuthUid(null);
      setTeam(null);
      setScore(null);
      return;
    }
    const res = await fetch("/api/team", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const j = await res.json();
      setTeam(j.team);
      setScore(j.score);
    } else {
      setTeam(null);
      setScore(null);
      if (res.status === 401) setAuthUid(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setBooting(false));
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/stages");
        const j = await res.json();
        if (alive && res.ok) setStages(j.stages as StageMap);
        await refresh();
      } catch {
        /* Retry at the next poll after a network interruption. */
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh]);

  async function claimTeam() {
    try {
      await api("/api/team", { name: teamName.trim() });
      setAuthErr("");
      await refresh();
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Claim failed");
    }
  }

  async function signUp() {
    setAuthErr("");
    if (!teamName.trim()) return setAuthErr("Pick a team name first.");
    const { error } = await sb().auth.signUp({ email, password: pass });
    if (error) return setAuthErr(error.message);
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    const uid = sess.session?.user.id;
    if (!token || !uid) {
      setAuthErr(
        "Account created. Check your inbox to confirm it, then log in. If the mail never arrives, ask a volunteer at check-in.",
      );
      return;
    }
    // Server path creates the team row (service role) and the DB trigger
    // creates the scores row, so signup is playable regardless of RLS flow.
    // Unique(name) gives first-claim-wins; a 409 means the name is taken.
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) {
          return setAuthErr(
            j?.error ?? "That team name is taken. Pick another.",
          );
        }
        return setAuthErr(
          j?.error ?? "Team claim failed. Try again after logging in.",
        );
      }
      if (j?.team) {
        await refresh();
        return;
      }
    } catch {
      return setAuthErr("Signup needs network. Try logging in.");
    }
    await refresh();
  }

  async function signIn() {
    setAuthErr("");
    const { error } = await sb().auth.signInWithPassword({
      email,
      password: pass,
    });
    if (error) return setAuthErr(error.message);
    await refresh();
  }

  async function signOut() {
    await sb().auth.signOut();
    setTeam(null);
    setScore(null);
    setAuthUid(null);
  }

  if (booting)
    return (
      <div className="app-shell">
        <main className="app-main">
          <span className="spinner" />
        </main>
      </div>
    );

  if (!authUid) {
    return (
      <div className="app-shell">
        <Nav />
        <main className="app-main" style={{ maxWidth: 480 }}>
          <p className="eyebrow">Team Console</p>
          <h1 className="headline">Log in</h1>
          <p className="sub">Use the team account created at check-in.</p>
          <div style={{ display: "grid", gap: "var(--sp-md)" }}>
            <input
              className="input"
              placeholder="team email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <input
              className="input"
              placeholder="team name (signup only)"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
            {authErr && <p className="error-text">{authErr}</p>}
            <div style={{ display: "flex", gap: "var(--sp-md)" }}>
              <button className="btn btn-primary" onClick={signIn}>
                Log in
              </button>
              <button className="btn btn-secondary" onClick={signUp}>
                Sign up
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!team)
    return (
      <div className="app-shell">
        <Nav />
        <main className="app-main" style={{ maxWidth: 480 }}>
          <h1>Claim your team</h1>
          <p>Use the team name registered at check-in.</p>
          <label>
            Team name
            <input
              className="input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" onClick={claimTeam}>
            Claim team
          </button>
          {authErr && <p role="alert">{authErr}</p>}
          <button className="btn btn-secondary" onClick={signOut}>
            Log out
          </button>
        </main>
      </div>
    );

  return (
    <div className="app-shell">
      <Nav />
      <main className="app-main">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "var(--sp-md)",
          }}
        >
          <div>
            <p className="eyebrow">Team Console</p>
            <h1 className="headline" style={{ marginBottom: 0 }}>
              {team?.name ?? "…"}
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              className="hero-meta-value"
              style={{ fontSize: 32, color: "var(--primary)" }}
            >
              {score?.total ?? 0}{" "}
              <span style={{ fontSize: 16 }} className="muted">
                pts
              </span>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={signOut}>
              Log out
            </button>
          </div>
        </div>

        <div className="sep" />

        <div
          style={{
            display: "flex",
            gap: "var(--sp-sm)",
            flexWrap: "wrap",
            marginBottom: "var(--sp-xl)",
          }}
        >
          {(
            [
              ["calc", "Hash Calculator", null],
              ["s1", "Stage 1 · Sort", "stage1"],
              ["s2", "Stage 2 · Mine", "stage2"],
              ["s3", "Stage 3 · Forger", "stage3"],
              ["s4", "Stage 4 · Bonus", "stage4"],
              ["s5", "S5 · Finale", "stage5"],
            ] as [Tab, string, string | null][]
          ).map(([id, label, stageKey]) => {
            const open = stageKey ? stages[stageKey]?.open : undefined;
            return (
              <button
                key={id}
                className={`btn btn-sm ${tab === id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setTab(id)}
              >
                {label}
                {open !== undefined && (
                  <span className="tag" style={{ marginLeft: 6 }}>
                    {open ? "open" : "closed"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "calc" && <Calculator target="" />}
        {tab === "s1" && (
          <Stage1
            onDone={refresh}
            solved={(score?.stage1_base ?? 0) > 0}
            attempts={score?.stage1_attempts ?? 0}
            lockedUntil={score?.stage1_locked_until ?? null}
          />
        )}
        {tab === "s2" && (
          <Stage2 onDone={refresh} solved={(score?.stage2_base ?? 0) > 0} />
        )}
        {tab === "s3" && (
          <Stage3 onDone={refresh} solved={(score?.stage3_base ?? 0) > 0} />
        )}
        {tab === "s4" && (
          <Stage4
            onDone={refresh}
            claimed={(score?.stage4_bonus ?? 0) > 0}
            submitted={!!score?.stage4_submitted_at}
          />
        )}
        {tab === "s5" && (
          <Stage5
            onDone={refresh}
            open={stages.stage5?.open ?? false}
            submitted={(score?.stage5_attempts ?? 0) > 0}
          />
        )}
      </main>
    </div>
  );
}

function Nav() {
  return (
    <nav className="app-nav">
      <Link href="/" className="app-brand">
        Block<span>Hunt</span> &apos;26
      </Link>
      <ul className="app-nav-links">
        <li>
          <Link href="/leaderboard">Leaderboard</Link>
        </li>
        <li>
          <Link href="/forks">Fork Pool</Link>
        </li>
      </ul>
    </nav>
  );
}

/* ── hash calculator ── */
function Calculator({ target }: { target: string }) {
  const [prev, setPrev] = useState("00000000");
  const [nonce, setNonce] = useState("0");
  const [data, setData] = useState("");
  const n = parseInt(nonce || "0", 10) || 0;
  const valid =
    /^[0-9a-f]{8}$/i.test(prev.trim()) &&
    Number.isSafeInteger(n) &&
    n >= 0 &&
    n <= 1000000000;
  const hash = valid
    ? blockHash(prev.trim().toLowerCase(), n, data.trim())
    : "Invalid input";
  const meets = target ? hash.startsWith(target.toLowerCase()) : false;
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Hash Calculator</p>
      <div style={{ display: "grid", gap: "var(--sp-md)" }}>
        <label>
          prev_hash (8 hex)
          <input
            className="input"
            value={prev}
            onChange={(e) => setPrev(e.target.value)}
            maxLength={8}
          />
        </label>
        <label>
          nonce
          <input
            className="input"
            inputMode="numeric"
            value={nonce}
            onChange={(e) => setNonce(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label>
          data
          <input
            className="input"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <div
          className="card-dark"
          style={{ borderRadius: "var(--r-md)", padding: "var(--sp-lg)" }}
        >
          <div className="eyebrow" style={{ color: "var(--mute)" }}>
            hash
          </div>
          <div
            className="mono"
            style={{
              fontSize: 28,
              color: "var(--primary)",
              wordBreak: "break-all",
            }}
          >
            {hash}
          </div>
          <div
            className="muted"
            style={{ color: "var(--mute)", fontSize: 13, marginTop: 4 }}
          >
            Teaching hash for Stages 1, 3, 4 and 5. Stage 2 mining proofs are
            calculated on the server.
          </div>
        </div>
      </div>
    </div>
  );
}

async function api(path: string, body?: unknown) {
  const { data } = await sb().auth.getSession();
  if (!data.session) throw new Error("Session expired, log in again");
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${data.session.access_token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

type EvidenceBlock = {
  index: number;
  chain: string;
  prev: string;
  nonce: number;
  data: string;
  hash: string;
};
function Evidence({ stage }: { stage: 1 | 3 }) {
  const [blocks, setBlocks] = useState<EvidenceBlock[]>([]),
    [err, setErr] = useState("");
  const [view, setView] = useState("data");
  useEffect(() => {
    let alive = true;
    const load = () =>
      api(`/api/stage${stage}`)
        .then((j) => {
          if (alive) {
            setBlocks(j.blocks);
            setErr("");
          }
        })
        .catch((e) => {
          if (alive) {
            setBlocks([]);
            setErr(e.message);
          }
        });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stage]);
  return (
    <div>
      {err && <p role="status">{err}</p>}
      {stage === 3 && (
        <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
          {["data", "hashes", "links"].map((v) => (
            <button
              className="btn btn-sm btn-secondary"
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
        }}
      >
        {blocks.map((b) => (
          <div className="card" key={b.index}>
            <strong>
              Block {b.index}
              {stage === 3 ? ` · Chain ${b.chain}` : ""}
            </strong>
            <div className="mono" style={{ overflowWrap: "anywhere" }}>
              {(stage === 1 || view === "data") && (
                <>
                  <p>Data: {b.data}</p>
                  <p>Nonce: {b.nonce}</p>
                </>
              )}
              {(stage === 1 || view === "hashes") && <p>Hash: {b.hash}</p>}
              {(stage === 1 || view === "links") && <p>Previous: {b.prev}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stage1({
  onDone,
  solved,
  attempts,
  lockedUntil,
}: {
  onDone: () => void;
  solved: boolean;
  attempts: number;
  lockedUntil: string | null;
}) {
  const [order, setOrder] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const locked = !!lockedUntil && new Date(lockedUntil).getTime() > Date.now();
  async function send() {
    setBusy(true);
    try {
      const j = await api("/api/stage1", {
        order: order
          .split(",")
          .map((s) => (s.trim() === "" ? null : Number(s.trim()))),
      });
      setMsg(
        j.correct
          ? `Correct! +${j.awarded} points`
          : `Wrong order. ${j.attemptsLeft} guesses remain.`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <section>
      <h2>Stage 1 · Sort the Chain</h2>
      <p>
        Follow previous hashes from 00000000. Each label appears once.{" "}
        {3 - attempts} guesses remain; wrong guesses lock for 60 seconds.
      </p>
      <Evidence stage={1} />
      <label>
        Chain order (comma separated labels)
        <input
          className="input"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          disabled={solved}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={busy || solved || locked || attempts >= 3}
        onClick={send}
      >
        Submit order
      </button>
      <p role="status">
        {solved
          ? "Solved!"
          : locked
            ? "Locked for 60 seconds after a wrong guess."
            : msg}
      </p>
    </section>
  );
}

function Stage2({ onDone, solved }: { onDone: () => void; solved: boolean }) {
  const [challenge, setChallenge] = useState<{
      id: string;
      data: string;
      prev_hash: string;
    } | null>(null),
    [parent, setParent] = useState(""),
    [nonce, setNonce] = useState(""),
    [prefix, setPrefix] = useState("0"),
    [blocks, setBlocks] = useState<{ id: number; hash: string }[]>([]),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const path = `/api/stage2${parent ? `?parent=${parent}` : ""}`;
  const load = useCallback(async () => {
    try {
      const j = await api(path);
      setChallenge(j.challenge);
      setBlocks(j.blocks);
      setPrefix(j.config.difficulty_prefix);
    } catch (e) {
      setChallenge(null);
      setMsg((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  async function send() {
    if (!challenge || nonce.trim() === "") return;
    setBusy(true);
    try {
      const j = await api(path, {
        nonce: Number(nonce),
        challenge_id: challenge.id,
      });
      setMsg(
        j.accepted
          ? `Accepted block #${j.pool_id}! +${j.awarded} points`
          : `Proof ${j.proof.slice(0, 16)} does not meet prefix ${prefix}.`,
      );
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <section className="card">
      <h2>Stage 2 · Mine to Match</h2>
      <p>
        One server proof attempt per team every 3 seconds. Target prefix:{" "}
        {prefix}. Challenge data and parent are fixed. A successful attempt
        advances your challenge.
      </p>
      {solved && (
        <p className="success-text">
          First block scored. Extend or branch your chain for the finale.
        </p>
      )}
      <label>
        Build on
        <select
          aria-label="Build on"
          className="input"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">Genesis (new root)</option>
          {blocks.map((b) => (
            <option value={b.id} key={b.id}>
              Block #{b.id} · {b.hash}
            </option>
          ))}
        </select>
      </label>
      {challenge && (
        <p className="mono">
          Data: {challenge.data}
          <br />
          Previous: {challenge.prev_hash}
        </p>
      )}
      <label>
        Nonce
        <input
          className="input"
          inputMode="numeric"
          value={nonce}
          onChange={(e) => setNonce(e.target.value)}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={busy || !challenge}
        onClick={send}
      >
        Try nonce
      </button>
      <p role="status">{msg}</p>
    </section>
  );
}

function Stage3({ onDone, solved }: { onDone: () => void; solved: boolean }) {
  const [block, setBlock] = useState(""),
    [explanation, setExplanation] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const j = await api("/api/stage3", {
        tampered_block: block.trim() === "" ? null : Number(block),
        explanation,
      });
      setMsg(
        j.correct
          ? `Right block! +${j.awarded} points. Judges can award up to 20 for evidence.`
          : `Wrong block. ${j.attemptsLeft} guesses remain; wait 60 seconds.`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <section>
      <h2>Stage 3 · Catch the Forger</h2>
      <p>
        Inspect both six-block chains. Share the data, hashes and links tabs
        with teammates. Recompute each block with the teaching calculator and
        identify the changed data. Explain the first mismatch and why
        descendants are affected. Three guesses, with a 60 second lockout after
        each wrong guess.
      </p>
      <Evidence stage={3} />
      <label>
        Tampered block label
        <input
          className="input"
          value={block}
          onChange={(e) => setBlock(e.target.value)}
        />
      </label>
      <label>
        Evidence (30..5120 characters)
        <textarea
          className="textarea"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={busy || solved}
        onClick={send}
      >
        Submit investigation
      </button>
      <p role="status">
        {solved ? "Solved; explanation awaits judging." : msg}
      </p>
    </section>
  );
}

function Stage4({
  onDone,
  claimed,
}: {
  onDone: () => void;
  claimed: boolean;
  submitted: boolean;
}) {
  const [p, setP] = useState<{
      prev: string;
      data: string;
      target: string;
    } | null>(null),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () =>
      api("/api/stage4")
        .then(setP)
        .catch((e) => {
          setP(null);
          setMsg(e.message);
        });
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  async function send() {
    setBusy(true);
    try {
      const j = await api("/api/stage4", {
        nonce_a: a.trim() === "" ? null : Number(a),
        nonce_b: b.trim() === "" ? null : Number(b),
      });
      setMsg(
        j.correct
          ? "Collision confirmed! +50 points."
          : "Those nonces do not both match the target. Try the calculator.",
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <section className="card">
      <h2>Stage 4 · Collision Hunt (optional)</h2>
      <p>
        Find two different nonces from 0..9999 that produce the target teaching
        hash using this fixed data. Think about digit sums. One submission
        attempt every 3 seconds.
      </p>
      {p && (
        <p className="mono">
          Previous: {p.prev}
          <br />
          Data: {p.data}
          <br />
          Target: {p.target}
        </p>
      )}
      <label>
        First nonce
        <input
          className="input"
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
      </label>
      <label>
        Second nonce
        <input
          className="input"
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={busy || claimed || !p}
        onClick={send}
      >
        Submit collision
      </button>
      <p role="status">{claimed ? "+50 points awarded" : msg}</p>
    </section>
  );
}

function Stage5({
  onDone,
  open,
  submitted,
}: {
  onDone: () => void;
  open: boolean;
  submitted: boolean;
}) {
  const [branches, setBranches] = useState(""),
    [index, setIndex] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const parsed = branches
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => ({
          block_ids: l
            .split(",")
            .map((v) => (v.trim() === "" ? null : Number(v))),
        }));
      const j = await api("/api/stage5", {
        branches: parsed,
        longest_branch_index: index.trim() === "" ? null : Number(index),
      });
      setMsg(`Branches +${j.branch_pts}; longest +${j.longest_pts}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <section className="card">
      <h2>Stage 5 · Consensus Finale</h2>
      <p>
        {open
          ? "Finalists: open the frozen fork pool, verify blocks and reconstruct branches from genesis. One submission. 10 points per distinct valid path (max 50), plus 100 for a longest valid path."
          : "Stage 5 is closed."}
      </p>
      <Link href="/forks">Inspect finalist pool</Link>
      <label>
        One branch per line, comma separated pool IDs
        <textarea
          className="textarea"
          rows={5}
          value={branches}
          onChange={(e) => setBranches(e.target.value)}
        />
      </label>
      <label>
        Longest branch line index (first line is 0)
        <input
          className="input"
          value={index}
          onChange={(e) => setIndex(e.target.value)}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={busy || !open || submitted}
        onClick={send}
      >
        Submit finale branches
      </button>
      <p role="status">{msg || (submitted ? "Finale submitted." : "")}</p>
    </section>
  );
}
