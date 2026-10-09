"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

type StageKey = "stage1" | "stage2" | "stage3" | "stage4" | "stage5";
type Cfg = {
  open: boolean;
  started_at: string | null;
  duration_ms: number;
  [k: string]: unknown;
};
type TeamRow = { id: string; name: string };

const sb = () => supabaseBrowser();

async function adminToken(): Promise<string | null> {
  const { data: sess } = await sb().auth.getSession();
  return sess.session?.access_token ?? null;
}

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [cfgs, setCfgs] = useState<Record<string, Cfg>>({});
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [judgeTeam, setJudgeTeam] = useState("");
  const [judgePoints, setJudgePoints] = useState("0");
  const [judging, setJudging] = useState<
    {
      team_id: string;
      payload: { explanation?: string; tampered_block?: number };
    }[]
  >([]);
  const [prefix, setPrefix] = useState("00");
  const [nonceMax, setNonceMax] = useState("");
  const [finalistNames, setFinalistNames] = useState("");
  const [finalistCount, setFinalistCount] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await adminToken();
    if (!token) return;
    const res = await fetch("/api/admin/config", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const j = await res.json();
    const m: Record<string, Cfg> = {};
    for (const row of j.configs ?? []) m[row.key] = row.value as Cfg;
    setCfgs(m);
    const s2 = (m.stage2 ?? {}) as Cfg;
    setPrefix(String(s2.difficulty_prefix ?? "00"));
    setNonceMax(
      s2.nonce_max === undefined || s2.nonce_max === null
        ? ""
        : String(s2.nonce_max),
    );
    setTeams((j.teams ?? []) as TeamRow[]);
    setJudging(j.judging ?? []);
    const fids = new Set(((m.stage5?.finalists as string[]) ?? []) as string[]);
    const fnames = ((j.teams ?? []) as TeamRow[])
      .filter((t) => fids.has(t.id))
      .map((t) => t.name);
    setFinalistNames(fnames.join(", "));
    setFinalistCount(fids.size);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: sess } = await sb().auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return setIsAdmin(false);
      // admin_users has an RLS policy: only admins can select it, so a hit means admin
      const { data: admin } = await sb()
        .from("admin_users")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();
      setIsAdmin(!!admin);
      if (admin) await load();
    })();
  }, [load]);

  async function signIn() {
    setAuthErr("");
    const { error } = await sb().auth.signInWithPassword({
      email,
      password: pass,
    });
    if (error) return setAuthErr(error.message);
    const { data: sess } = await sb().auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      const { data: admin } = await sb()
        .from("admin_users")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();
      setIsAdmin(!!admin);
      if (admin) await load();
    }
  }

  async function adminPost(payload: Record<string, unknown>) {
    const token = await adminToken();
    if (!token) {
      setMsg("Session expired, log in again.");
      return null;
    }
    const res = await fetch("/api/admin/config", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg(j?.error ?? "Save failed.");
      return null;
    }
    return j;
  }

  async function setStage(key: StageKey, open: boolean) {
    if (
      open &&
      !window.confirm(
        `Open ${key}? The first opening starts its clock. Closing and reopening does not restart it.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("");
    const j = await adminPost({ action: "stage", key, open });
    if (j) await load();
    setBusy(false);
  }

  async function commitStage2() {
    const p = prefix.trim().toLowerCase();
    const nm = nonceMax.trim() === "" ? null : Number(nonceMax.trim());
    if (!/^[0-9a-f]{1,2}$/.test(p))
      return setMsg("Difficulty prefix must be 1 to 2 hex chars.");
    if (nm !== null && (!Number.isInteger(nm) || nm <= 0))
      return setMsg("Nonce cap must be a positive integer or empty.");
    setBusy(true);
    setMsg("");
    const j = await adminPost({
      action: "secret",
      key: "stage2",
      value: { difficulty_prefix: p, nonce_max: nm },
    });
    if (j) {
      setMsg("Stage 2 settings saved.");
      await load();
    }
    setBusy(false);
  }

  async function commitFinalists() {
    setBusy(true);
    setMsg("");
    const j = await adminPost({
      action: "finalists",
      finalists: finalistNames,
    });
    if (j) {
      setMsg(
        `Finalists saved: ${j.count} team(s). Only these teams can submit Stage 5.`,
      );
      await load();
    }
    setBusy(false);
  }

  if (isAdmin === null)
    return (
      <div className="app-shell">
        <main className="app-main">
          <span className="spinner" />
        </main>
      </div>
    );

  if (!isAdmin) {
    return (
      <div className="app-shell">
        <nav className="app-nav">
          <Link href="/" className="app-brand">
            Block<span>Hunt</span> &apos;26
          </Link>
        </nav>
        <main className="app-main" style={{ maxWidth: 420 }}>
          <p className="eyebrow">Admin</p>
          <h1 className="headline">Organizer login</h1>
          <div style={{ display: "grid", gap: "var(--sp-md)" }}>
            <input
              className="input"
              placeholder="organizer email"
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
            {authErr && <p className="error-text">{authErr}</p>}
            <button className="btn btn-primary" onClick={signIn}>
              Log in
            </button>
            <p className="muted" style={{ fontSize: 14 }}>
              Not seeing controls after login? Your user must be added to
              admin_users (see README).
            </p>
          </div>
        </main>
      </div>
    );
  }

  const stages: [StageKey, string][] = [
    ["stage1", "Stage 1 · Sort the Chain"],
    ["stage2", "Stage 2 · Mine to Match"],
    ["stage3", "Stage 3 · Catch the Forger"],
    ["stage4", "Stage 4 · Collision Hunt"],
    ["stage5", "Stage 5 · Consensus Finale"],
  ];

  return (
    <div className="app-shell">
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
      <main className="app-main">
        <p className="eyebrow">Admin</p>
        <h1 className="headline">Stage control</h1>
        <p className="sub">
          Open and close stages on the day. Opening stamps the start time. The
          app computes speed bonuses from it.
        </p>
        {msg && (
          <p className="mono" style={{ fontSize: 14 }}>
            {msg}
          </p>
        )}

        <div style={{ display: "grid", gap: "var(--sp-lg)" }}>
          {stages.map(([key, label]) => {
            const c = cfgs[key];
            return (
              <div
                key={key}
                className="card"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "var(--sp-md)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {c
                      ? c.open
                        ? `open · started ${c.started_at ? new Date(c.started_at).toLocaleTimeString() : "not stamped"}`
                        : "closed"
                      : "loading..."}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "var(--sp-sm)" }}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy || c?.open}
                    onClick={() => setStage(key, true)}
                  >
                    Open
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    disabled={busy || !c?.open}
                    onClick={() => setStage(key, false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sep" />
        <h2 className="headline" style={{ fontSize: 22 }}>
          Stage settings
        </h2>
        <div style={{ display: "grid", gap: "var(--sp-lg)", maxWidth: 640 }}>
          <div
            className="card"
            style={{ display: "grid", gap: "var(--sp-md)" }}
          >
            <div style={{ fontWeight: 600 }}>
              Stage 2 difficulty and nonce cap
            </div>
            <div
              style={{ display: "flex", gap: "var(--sp-md)", flexWrap: "wrap" }}
            >
              <input
                className="input"
                style={{ width: 140 }}
                placeholder="prefix, e.g. 00"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                disabled={busy}
              />
              <input
                className="input"
                style={{ width: 200 }}
                placeholder="nonce cap (empty = none)"
                value={nonceMax}
                onChange={(e) => setNonceMax(e.target.value.replace(/\D/g, ""))}
                disabled={busy}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={commitStage2}
              >
                Save
              </button>
            </div>
          </div>

          <div
            className="card"
            style={{ display: "grid", gap: "var(--sp-md)" }}
          >
            <div style={{ fontWeight: 600 }}>
              Stage 5 finalists ({finalistCount} set)
            </div>
            <p className="muted" style={{ fontSize: 14 }}>
              Top 4 to 6 teams after Stage 3 and Stage 4. Comma-separated team
              names. Only listed teams can submit Stage 5.
            </p>
            <textarea
              className="textarea"
              rows={3}
              placeholder="e.g. HashHunters, NonceSense, BlockParty"
              value={finalistNames}
              onChange={(e) => setFinalistNames(e.target.value)}
              disabled={busy}
            />
            <button
              className="btn btn-sm btn-primary"
              style={{ justifySelf: "start" }}
              disabled={busy}
              onClick={commitFinalists}
            >
              Save finalists
            </button>
            <p className="muted" style={{ fontSize: 13 }}>
              Registered teams ({teams.length}):{" "}
              {teams.map((t) => t.name).join(", ") || "none yet"}
            </p>
          </div>
        </div>

        <div className="sep" />
        <section className="card">
          <h2>Stage 3 explanation judging</h2>
          <p>
            0: no evidence; 5: identifies mismatch; 10: correct recalculation;
            15: explains broken continuity; 20: clear evidence and downstream
            impact.
          </p>
          <label>
            Team
            <select
              aria-label="Team"
              className="input"
              value={judgeTeam}
              onChange={(e) => setJudgeTeam(e.target.value)}
            >
              <option value="">Choose team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {judging
            .filter((j) => j.team_id === judgeTeam)
            .map((j, i) => (
              <p key={i}>
                Block {j.payload.tampered_block}: {j.payload.explanation}
              </p>
            ))}
          <label>
            Rubric points
            <input
              className="input"
              type="number"
              min={0}
              max={20}
              value={judgePoints}
              onChange={(e) => setJudgePoints(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={busy || !judgeTeam}
            onClick={async () => {
              setBusy(true);
              try {
                const j = await adminPost({
                  action: "judge",
                  team_id: judgeTeam,
                  points: Number(judgePoints),
                });
                if (j) setMsg("Judging saved.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save judging
          </button>
        </section>
      </main>
    </div>
  );
}
