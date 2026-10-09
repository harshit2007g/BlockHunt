"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  rank: number;
  team: string;
  total: number;
  lastSubmit: string;
  stages: { s1: number; s2: number; s3: number; s4: number; s5: number };
};

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/leaderboard");
        if (!res.ok) throw new Error(await res.text());
        const j = await res.json();
        if (alive) { setRows(j.rows); setErr(""); }
      } catch {
        if (alive) setErr("Leaderboard unavailable. Check that the backend is configured.");
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link href="/" className="app-brand">Block<span>Hunt</span> &apos;26</Link>
        <ul className="app-nav-links">
          <li><Link href="/play">Team Console</Link></li>
          <li><Link href="/forks">Fork Pool</Link></li>
        </ul>
      </nav>
      <main className="app-main" style={{ maxWidth: 980 }}>
        <p className="eyebrow">Live Leaderboard</p>
        <h1 className="headline">Standings</h1>
        <p className="sub">Auto-refreshes every 5 seconds. Ties go to the team that reached its score first.</p>

        {err && <p className="error-text">{err}</p>}
        {!rows && !err && <span className="spinner" />}

        {rows && rows.length === 0 && <p className="muted">No scores yet. The hunt is about to begin.</p>}

        {rows && rows.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 17 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid var(--ink)" }}>
                <th style={th}>#</th>
                <th style={th}>Team</th>
                <th style={thNum}>S1</th>
                <th style={thNum}>S2</th>
                <th style={thNum}>S3</th>
                <th style={thNum}>S4</th>
                <th style={thNum}>S5</th>
                <th style={thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team} style={{ borderBottom: "1px solid var(--mute)" }}>
                  <td style={{ ...td, fontFamily: "var(--font-display)", color: r.rank <= 3 ? "var(--primary)" : "var(--body-mid)" }}>
                    {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.team}</td>
                  <td style={tdNum}>{r.stages.s1}</td>
                  <td style={tdNum}>{r.stages.s2}</td>
                  <td style={tdNum}>{r.stages.s3}</td>
                  <td style={tdNum}>{r.stages.s4}</td>
                  <td style={tdNum}>{r.stages.s5}</td>
                  <td style={{ ...tdNum, fontFamily: "var(--font-display)", fontSize: 22, color: "var(--primary)" }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}

const th: React.CSSProperties = { padding: "var(--sp-md)", fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "var(--body-mid)" };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "var(--sp-md)" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)" };
