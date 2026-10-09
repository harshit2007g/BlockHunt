"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

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

  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const { data } = await supabaseBrowser().auth.getSession();
        const res = await fetch("/api/forks", {
          headers: {
            authorization: `Bearer ${data.session?.access_token ?? ""}`,
          },
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error);
        }
        const j = await res.json();
        if (alive) {
          setBlocks(j.blocks);
          setErr("");
        }
      } catch (e) {
        if (alive) {
          setBlocks(null);
          setErr(e instanceof Error ? e.message : "Fork pool unavailable");
        }
      }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const levels = blocks ? [[...blocks].sort((a, b) => a.id - b.id)] : [];

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link href="/" className="app-brand">
          Block<span>Hunt</span> &apos;26
        </Link>
        <ul className="app-nav-links">
          <li>
            <Link href="/play">Team Console</Link>
          </li>
          <li>
            <Link href="/leaderboard">Leaderboard</Link>
          </li>
        </ul>
      </nav>
      <main className="app-main" style={{ maxWidth: 1100 }}>
        <p className="eyebrow">Consensus Finale · Fork Pool</p>
        <h1 className="headline">The shared chain pool</h1>
        <p className="sub">
          Frozen finalist blocks. Recompute their teaching hashes and follow
          declared parent IDs from genesis. Find the longest valid path
          yourselves.
        </p>

        {err && <p className="error-text">{err}</p>}
        {!blocks && !err && <span className="spinner" />}
        {blocks && blocks.length === 0 && (
          <p className="muted">
            Pool is empty. Blocks appear as teams mine them in Stage 2.
          </p>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-lg)",
          }}
        >
          {levels.map((level, li) => (
            <div key={li}>
              {li > 0 && (
                <div className="block-arrow" style={{ marginBottom: 6 }}>
                  ↓
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                  gap: "var(--sp-md)",
                }}
              >
                {level.map((b) => {
                  return (
                    <div
                      key={b.id}
                      className="card"
                      style={{ marginBottom: 0, overflowWrap: "anywhere" }}
                    >
                      <div className="block-number">
                        #{b.id} · block {b.block_index} · {b.team_name}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 22, margin: "12px 0" }}
                      >
                        {b.hash}
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        <span>prev: {b.prev_hash}</span>
                        <span>nonce: {b.nonce}</span>
                        {b.data ? (
                          <>
                            <span>data: {b.data}</span>
                          </>
                        ) : null}
                      </div>
                      <div className="mono">
                        Parent ID: {b.parent_block ?? "genesis"}
                      </div>
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
