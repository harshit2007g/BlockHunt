import { NextResponse } from "next/server";
import { finalistPool } from "@/lib/event-server";
import type { PoolBlock } from "@/lib/supabase";

export async function GET(req: Request) {
  const r = await finalistPool(req);
  if (r.error) return r.error;
  const blocks = (r.pool as (PoolBlock & { team_name: string })[]).map((b) => ({
    id: b.id,
    team_id: b.team_id,
    team_name: b.team_name,
    block_index: b.block_index,
    nonce: b.nonce,
    hash: b.hash,
    prev_hash: b.prev_hash,
    data: b.data,
    parent_block: b.parent_block,
  }));
  return NextResponse.json(
    { blocks },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
