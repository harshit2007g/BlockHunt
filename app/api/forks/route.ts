import { NextResponse } from "next/server";
import { connection } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { PoolBlock } from "@/lib/supabase";
import { isPoolBlockHashValid } from "@/lib/chain";


export async function GET() {
  // Live pool: never prerender, always query at request time.
  await connection();
  const db = supabaseAdmin();
  const { data: pool, error } = await db
    .from("mining_pool")
    .select("id, team_id, block_index, nonce, hash, prev_hash, data, parent_team, parent_block, valid, created_at")
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: teams } = await db.from("teams").select("id, name");

  const nameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const blocks = ((pool ?? []) as PoolBlock[]).map((b) => ({
    ...b,
    team_name: nameById.get(b.team_id) ?? "?",
    recomputed_valid: isPoolBlockHashValid(b),
  }));

  // longest chain via parent links. Validity is recomputed from
  // H(prev_hash, nonce, data); the stored flag is shown but not trusted.
  const valid = blocks.filter((b) => isPoolBlockHashValid(b));
  const childrenOf = new Map<number | null, PoolBlock[]>();
  for (const b of valid) {
    const key = b.parent_block;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(b);
  }
  const depth = (b: PoolBlock, seen: Set<number> = new Set<number>()): number => {
    if (seen.has(b.id)) return 0;
    seen.add(b.id);
    const kids = childrenOf.get(b.id) ?? [];
    return 1 + Math.max(0, ...kids.map((k) => depth(k, seen)));
  };
  const longest = Math.max(0, ...valid.filter((b) => b.parent_block === null).map((b) => depth(b)));

  return NextResponse.json({ blocks, longest });
}
