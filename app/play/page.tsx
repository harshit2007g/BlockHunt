"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser, type Team, type Scores } from "@/lib/supabase";
import { blockHash } from "@/lib/hash";

type Tab = "calc" | "s1" | "s2" | "s3" | "s4" | "s5";

type StageMap = Record<string, { open: boolean; difficulty_prefix?: string }>;

const sb = () => supabaseBrowser();

function sessionToken(sess: { session?: { access_token: string } | null } | null): string | null {
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
    if (!uid) return;
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
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setBooting(false));
  }, [refresh]);

  useEffect(() => {
    fetch("/api/stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.stages) setStages(j.stages as StageMap);
      })
      .catch(() => {});
  }, []);

  async function signUp() {
    setAuthErr("");
    if (!teamName.trim()) return setAuthErr("Pick a team name first.");
    const { error } = await sb().auth.signUp({ email, password: pass });
    if (error) return setAuthErr(error.message);
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    const uid = sess.session?.user.id;
    if (!token || !uid) {
      setAuthErr("Account created. Check your inbox to confirm it, then log in. If the mail never arrives, ask a volunteer at check-in.");
      return;
    }
    // Server path creates the team row (service role) and the DB trigger
    // creates the scores row, so signup is playable regardless of RLS flow.
    // Unique(name) gives first-claim-wins; a 409 means the name is taken.
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) {
          return setAuthErr(j?.error ?? "That team name is taken. Pick another.");
        }
        // Fall back to the RLS-guarded client insert for older deployments.
        const { error: insErr } = await sb()
          .from("teams")
          .insert({ auth_uid: uid, name: teamName.trim() });
        if (insErr) {
          const msg = /duplicate|already exists|unique/i.test(insErr.message)
            ? "That team name is taken. Pick another."
            : `Signup failed: ${insErr.message}`;
          return setAuthErr(msg);
        }
        await refresh();
        return;
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
    const { error } = await sb().auth.signInWithPassword({ email, password: pass });
    if (error) return setAuthErr(error.message);
    await refresh();
  }

  async function signOut() {
    await sb().auth.signOut();
    setTeam(null);
    setScore(null);
    setAuthUid(null);
  }

  if (booting) return <div className="app-shell"><main className="app-main"><span className="spinner" /></main></div>;

  if (!authUid) {
    return (
      <div className="app-shell">
        <Nav />
        <main className="app-main" style={{ maxWidth: 480 }}>
          <p className="eyebrow">Team Console</p>
          <h1 className="headline">Log in</h1>
          <p className="sub">Use the team account created at check-in.</p>
          <div style={{ display: "grid", gap: "var(--sp-md)" }}>
            <input className="input" placeholder="team email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" type="password" placeholder="password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <input className="input" placeholder="team name (signup only)" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            {authErr && <p className="error-text">{authErr}</p>}
            <div style={{ display: "flex", gap: "var(--sp-md)" }}>
              <button className="btn btn-primary" onClick={signIn}>Log in</button>
              <button className="btn btn-secondary" onClick={signUp}>Sign up</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Nav />
      <main className="app-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "var(--sp-md)" }}>
          <div>
            <p className="eyebrow">Team Console</p>
            <h1 className="headline" style={{ marginBottom: 0 }}>{team?.name ?? "…"}</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="hero-meta-value" style={{ fontSize: 32, color: "var(--primary)" }}>
              {score?.total ?? 0} <span style={{ fontSize: 16 }} className="muted">pts</span>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={signOut}>Log out</button>
          </div>
        </div>

        <div className="sep" />

        <div style={{ display: "flex", gap: "var(--sp-sm)", flexWrap: "wrap", marginBottom: "var(--sp-xl)" }}>
          {([["calc", "Hash Calculator", null], ["s1", "Stage 1 · Sort", "stage1"], ["s2", "Stage 2 · Mine", "stage2"], ["s3", "Stage 3 · Forger", "stage3"], ["s4", "Stage 4 · Bonus", "stage4"], ["s5", "S5 · Finale", "stage5"]] as [Tab, string, string | null][]).map(([id, label, stageKey]) => {
            const open = stageKey ? stages[stageKey]?.open : undefined;
            return (
              <button key={id} className={`btn btn-sm ${tab === id ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(id)}>
                {label}
                {open !== undefined && (
                  <span className="tag" style={{ marginLeft: 6 }}>{open ? "open" : "closed"}</span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "calc" && <Calculator target={stages.stage2?.difficulty_prefix ?? "00"} />}
        {tab === "s1" && <Stage1 onDone={refresh} solved={(score?.stage1_base ?? 0) > 0} attempts={score?.stage1_attempts ?? 0} lockedUntil={score?.stage1_locked_until ?? null} />}
        {tab === "s2" && <Stage2 onDone={refresh} solved={(score?.stage2_base ?? 0) > 0} />}
        {tab === "s3" && <Stage3 onDone={refresh} solved={(score?.stage3_base ?? 0) > 0} />}
        {tab === "s4" && <Stage4 onDone={refresh} claimed={(score?.stage4_bonus ?? 0) > 0} submitted={!!score?.stage4_submitted_at} />}
        {tab === "s5" && <Stage5 onDone={refresh} open={stages.stage5?.open ?? false} submitted={(score?.stage5_attempts ?? 0) > 0} />}
      </main>
    </div>
  );
}

function Nav() {
  return (
    <nav className="app-nav">
      <Link href="/" className="app-brand">Block<span>Hunt</span> &apos;26</Link>
      <ul className="app-nav-links">
        <li><Link href="/leaderboard">Leaderboard</Link></li>
        <li><Link href="/forks">Fork Pool</Link></li>
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
  const hash = blockHash(prev.trim().toLowerCase(), n, data);
  const meets = target ? hash.startsWith(target.toLowerCase()) : false;
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Hash Calculator</p>
      <div style={{ display: "grid", gap: "var(--sp-md)" }}>
        <label>prev_hash (8 hex)
          <input className="input" value={prev} onChange={(e) => setPrev(e.target.value)} maxLength={8} />
        </label>
        <label>nonce
          <input className="input" inputMode="numeric" value={nonce} onChange={(e) => setNonce(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label>data
          <input className="input" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <div className="card-dark" style={{ borderRadius: "var(--r-md)", padding: "var(--sp-lg)" }}>
          <div className="eyebrow" style={{ color: "var(--mute)" }}>hash</div>
          <div className="mono" style={{ fontSize: 28, color: "var(--primary)", wordBreak: "break-all" }}>{hash}</div>
          <div className="muted" style={{ color: "var(--mute)", fontSize: 13, marginTop: 4 }}>
            starts with &quot;{hash.slice(0, 2)}&quot; {meets ? `· meets ${target} target ✓` : `· needs ${target} target`}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── stage 1 ── */
function Stage1({ onDone, solved, attempts, lockedUntil }: {
  onDone: () => void; solved: boolean; attempts: number; lockedUntil: string | null;
}) {
  const [order, setOrder] = useState("0,1,2,3");
  const [msg, setMsg] = useState("");
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!lockedUntil) return;
    const ms = new Date(lockedUntil).getTime() - Date.now();
    if (ms > 0) {
      setLocked(true);
      const t = setTimeout(() => setLocked(false), ms);
      return () => clearTimeout(t);
    }
  }, [lockedUntil]);

  async function submit() {
    setMsg("");
    const orderArr = order.split(",").map((s) => parseInt(s.trim(), 10));
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    if (!token) {
      setMsg("Session expired, log in again.");
      onDone();
      return;
    }
    const res = await fetch("/api/stage1", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ order: orderArr }),
    });
    const j = await res.json();
    if (j.correct) { setMsg(`Correct! +${j.awarded} pts`); onDone(); }
    else { setMsg(`${j.error ?? "Wrong order"} · attempts left: ${j.attemptsLeft}`); if (j.lockedUntil) setLocked(true); onDone(); }
  }

  if (solved) return <div className="card"><p className="success-text">Stage 1 solved. Wait for Stage 2 to open.</p></div>;

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Stage 1 · Sort the Chain</p>
      <p className="muted">Submit the block indexes in correct chain order, comma separated. {3 - attempts} guesses left.</p>
      <div style={{ display: "grid", gap: "var(--sp-md)", marginTop: "var(--sp-md)" }}>
        <input className="input" value={order} onChange={(e) => setOrder(e.target.value)} disabled={locked || solved} />
        <button className="btn btn-primary" onClick={submit} disabled={locked}>Submit order</button>
        {locked && <p className="error-text">Locked. The 60s penalty timer is running.</p>}
        {msg && <p className="error-text">{msg}</p>}
      </div>
    </div>
  );
}

/* ── stage 2 ── */
function Stage2({ onDone, solved }: { onDone: () => void; solved: boolean }) {
  const [blockIndex, setBlockIndex] = useState("1");
  const [prevHash, setPrevHash] = useState("");
  const [data, setData] = useState("");
  const [nonce, setNonce] = useState("0");
  const [parentBlock, setParentBlock] = useState("");
  const [msg, setMsg] = useState("");
  const [cooling, setCooling] = useState(false);

  async function submit() {
    setMsg("");
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    if (!token) {
      setMsg("Session expired, log in again.");
      onDone();
      return;
    }
    const parentNum = parseInt(parentBlock.trim(), 10);
    const res = await fetch("/api/stage2", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nonce: parseInt(nonce, 10) || 0,
        block_index: parseInt(blockIndex, 10) || 0,
        prev_hash: prevHash.trim().toLowerCase(),
        data: data.trim(),
        ...(Number.isInteger(parentNum) && parentNum > 0 ? { parent_block: parentNum } : {}),
      }),
    });
    const j = await res.json();
    if (j.accepted) {
      setMsg(`Accepted! hash ${j.hash}${j.pool_id ? ` · in pool #${j.pool_id}` : ""}`);
      setCooling(true);
      setTimeout(() => setCooling(false), 3000);
      onDone();
    } else {
      setMsg(j.error ?? `${j.hash}: ${j.reason}`);
      setCooling(true);
      setTimeout(() => setCooling(false), 3000);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Stage 2 · Mine to Match</p>
      <p className="muted">One attempt every 3 seconds. Hash must start with the announced difficulty target. Accepted blocks go to the shared fork pool.</p>
      {solved && <p className="success-text">First block already scored. Keep mining for the finale pool!</p>}
      <div style={{ display: "grid", gap: "var(--sp-md)", marginTop: "var(--sp-md)" }}>
        <input className="input" placeholder="block_index" value={blockIndex} onChange={(e) => setBlockIndex(e.target.value.replace(/\D/g, ""))} />
        <input className="input" placeholder="prev_hash (8 hex)" value={prevHash} onChange={(e) => setPrevHash(e.target.value)} maxLength={8} />
        <input className="input" placeholder="data" value={data} onChange={(e) => setData(e.target.value)} />
        <input className="input" placeholder="parent pool id (optional, the block you build on)" value={parentBlock} onChange={(e) => setParentBlock(e.target.value.replace(/\D/g, ""))} />
        <input className="input" placeholder="nonce" inputMode="numeric" value={nonce} onChange={(e) => setNonce(e.target.value.replace(/\D/g, ""))} />
        <button className="btn btn-primary" onClick={submit} disabled={cooling}>Submit nonce {cooling && <span className="spinner" />}</button>
        {msg && <p className="mono" style={{ fontSize: 14 }}>{msg}</p>}
      </div>
    </div>
  );
}

/* ── stage 3 ── */
function Stage3({ onDone, solved }: { onDone: () => void; solved: boolean }) {
  const [blockId, setBlockId] = useState("");
  const [explanation, setExplanation] = useState("");
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    if (!blockId.trim()) {
      setMsg("Enter a block number first.");
      return;
    }
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    if (!token) {
      setMsg("Session expired, log in again.");
      onDone();
      return;
    }
    const res = await fetch("/api/stage3", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ tampered_block: parseInt(blockId, 10), explanation }),
    });
    const j = await res.json();
    setMsg(j.error ?? (j.correctBlock ? `Right block! +${j.awarded} pts (+ judge rubric)` : j.note));
    onDone();
  }

  if (solved) return <div className="card"><p className="success-text">Submitted. Judges score the explanation against the rubric.</p></div>;

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Stage 3 · Catch the Forger</p>
      <p className="muted">Use the physical cards + calculator to find the tampered block. 3 guesses, with a 60s lockout after a wrong guess.</p>
      <div style={{ display: "grid", gap: "var(--sp-md)", marginTop: "var(--sp-md)" }}>
        <input className="input" placeholder="tampered block number" value={blockId} onChange={(e) => setBlockId(e.target.value.replace(/\D/g, ""))} />
        <textarea className="textarea" rows={4} placeholder="why is it invalid? (min 30 chars)" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <button className="btn btn-primary" onClick={submit}>Submit</button>
        {msg && <p className="mono" style={{ fontSize: 14 }}>{msg}</p>}
      </div>
    </div>
  );
}

/* ── stage 4 ── */
function Stage4({ onDone, claimed, submitted }: { onDone: () => void; claimed: boolean; submitted: boolean }) {
  const [txHash, setTxHash] = useState("");
  const [msg, setMsg] = useState("");
  const [contract, setContract] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await sb().auth.getSession();
      if (!sess.session) return;
      const res = await fetch("/api/stage4", { headers: { authorization: `Bearer ${sess.session.access_token}` } });
      if (res.ok) setContract((await res.json()).contract_address);
    })();
  }, []);

  async function submit() {
    setMsg("");
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    if (!token) {
      setMsg("Session expired, log in again.");
      onDone();
      return;
    }
    const res = await fetch("/api/stage4", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ tx_hash: txHash.trim() }),
    });
    const j = await res.json();
    setMsg(j.error ?? j.note);
    onDone();
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Stage 4 · Crack the Contract <span className="tag bonus">bonus</span></p>
      <p className="muted">Contract: <span className="mono">{contract || "announced when stage opens"}</span></p>
      <p className="muted">Open the browser console, call the contract, reach the success state, paste your tx hash.</p>
      <div style={{ display: "grid", gap: "var(--sp-md)", marginTop: "var(--sp-md)" }}>
        <input className="input" placeholder="0x… transaction hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} disabled={claimed || submitted} />
        <button className="btn btn-primary" onClick={submit} disabled={claimed || submitted}>Submit tx hash</button>
        {claimed && <p className="success-text">+50 claimed ✓</p>}
        {!claimed && submitted && <p className="muted">Submitted, waiting for volunteer verification. Your +50 appears after confirmation.</p>}
        {msg && <p className="mono" style={{ fontSize: 14 }}>{msg}</p>}
      </div>
    </div>
  );
}

/* ── stage 5 ── */
function Stage5({ onDone, open, submitted }: { onDone: () => void; open: boolean; submitted: boolean }) {
  const [branchesText, setBranchesText] = useState("");
  const [longestIdx, setLongestIdx] = useState("0");
  const [msg, setMsg] = useState("");

  if (!open) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <p className="eyebrow">S5 · Finale</p>
        <p className="muted">Stage 5 is closed. It opens for finalist teams after the earlier stages.</p>
      </div>
    );
  }

  async function submit() {
    setMsg("");
    const lines = branchesText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) {
      setMsg("Enter at least one branch (one line per branch, comma separated pool ids).");
      return;
    }
    const parsed: number[][] = [];
    for (const line of lines) {
      const ids = line.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n));
      if (ids.length === 0) {
        setMsg("Each line needs comma separated pool ids, e.g. 12, 45, 78.");
        return;
      }
      parsed.push(ids);
    }
    const longest = parseInt(longestIdx.trim(), 10);
    if (!Number.isInteger(longest) || longest < 0 || longest >= parsed.length) {
      setMsg("longest branch index must be a valid line number starting at 0.");
      return;
    }
    const { data: sess } = await sb().auth.getSession();
    const token = sessionToken(sess);
    if (!token) {
      setMsg("Session expired, log in again.");
      onDone();
      return;
    }
    const res = await fetch("/api/stage5", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ branches: parsed.map((block_ids) => ({ block_ids })), longest_branch_index: longest }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg(j?.error ?? "Submission failed. Try again.");
      onDone();
      return;
    }
    setMsg(`Valid branches: ${j.valid_branches} (+${j.branch_pts} pts) · longest bonus: +${j.longest_pts} pts`);
    onDone();
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">S5 · Finale</p>
      <p className="muted">Finalist teams only. List each branch on its own line as comma separated pool ids. Scoring: 10 pts per valid branch (max 50) plus 100 for the correct longest branch. One submission only.</p>
      <div style={{ display: "grid", gap: "var(--sp-md)", marginTop: "var(--sp-md)" }}>
        <textarea className="textarea" rows={5} placeholder={"e.g.\n12, 45, 78\n12, 46, 90"} value={branchesText} onChange={(e) => setBranchesText(e.target.value)} disabled={submitted} />
        <label>longest branch index (first line is 0)
          <input className="input" inputMode="numeric" value={longestIdx} onChange={(e) => setLongestIdx(e.target.value.replace(/[^0-9]/g, ""))} disabled={submitted} />
        </label>
        <button className="btn btn-primary" onClick={submit} disabled={submitted}>Submit finale branches</button>
        {submitted && <p className="muted">Submitted. Scores update after verification.</p>}
        {msg && <p className="mono" style={{ fontSize: 14 }}>{msg}</p>}
      </div>
    </div>
  );
}
