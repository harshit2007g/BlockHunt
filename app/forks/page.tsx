"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Block = {
  id: number;
  block_index: number;
  nonce: string;
  hash: string;
  prev_hash: string;
  data: string;
  parent_team: string | null;
  parent_block: number | null;
  valid: boolean;
  recomputed_valid?: boolean;
  team_name: string;
};

export default function ForksPage() {
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [longest, setLongest] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/forks");
        if (!res.ok) throw new Error();
        const j = await res.json();
        if (alive) { setBlocks(j.blocks); setLongest(j.longest); setErr(""); }
      } catch {
        if (alive) setErr("Fork pool unavailable. Check that the backend is configured.");
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // group by parent to render levels
  const levels: Block[][] = [];
  if (blocks) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const placed = new Set<number>();
    let frontier = blocks.filter((b) => b.parent_block === null || !byId.has(b.parent_block));
    while (frontier.length && placed.size < blocks.length) {
      levels.push(frontier);
      for (const b of frontier) placed.add(b.id);
      const next = blocks.filter(
        (b) => !placed.has(b.id) && b.parent_block !== null && placed.has(b.parent_block)
      );
      frontier = next;
    }
    const rest = blocks.filter((b) => !placed.has(b.id));
    if (rest.length) levels.push(rest);
  }

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link href="/" className="app-brand">Block<span>Hunt</span> &apos;26</Link>
        <ul className="app-nav-links">
          <li><Link href="/play">Team Console</Link></li>
          <li><Link href="/leaderboard">Leaderboard</Link></li>
        </ul>
      </nav>
      <main className="app-main" style={{ maxWidth: 1100 }}>
        <p className="eyebrow">Consensus Finale · Fork Pool</p>
        <h1 className="headline">The shared chain pool</h1>
        <p className="sub">
          All accepted Stage 2 blocks sit here, linked prev_hash to hash. Finalists
          reconstruct these branches. Longest valid branch right now:{" "}
          <strong className="owner-color">{longest} block{longest === 1 ? "" : "s"}</strong>.
        </p>

        {err && <p className="error-text">{err}</p>}
        {!blocks && !err && <span className="spinner" />}
        {blocks && blocks.length === 0 && (
          <p className="muted">Pool is empty. Blocks appear as teams mine them in Stage 2.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-lg)" }}>
          {levels.map((level, li) => (
            <div key={li}>
              {li > 0 && <div className="block-arrow" style={{ marginBottom: 6 }}>↓</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "var(--sp-md)" }}>
                {level.map((b) => {
                  const showValid = b.recomputed_valid ?? b.valid;
                  return (
                  <div key={b.id} className={`block-card${showValid ? " active-block" : ""}`} style={{ marginBottom: 0 }}>
                    <div className="block-number">
                      #{b.id} · block {b.block_index} · {b.team_name}
                    </div>
                    <div className="block-hash">{b.hash}</div>
                    <div className="block-data">
                      <span>prev: {b.prev_hash}</span>
                      <span className="divider-dot">·</span>
                      <span>nonce: {b.nonce}</span>
                      {b.data ? (
                        <>
                          <span className="divider-dot">·</span>
                          <span>data: {b.data}</span>
                        </>
                      ) : null}
                    </div>
                    {!showValid && <div className="error-text">invalid (excluded)</div>}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
