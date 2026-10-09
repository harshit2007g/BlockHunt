import { NextResponse } from "next/server";
import { requireTeam, eventKey, submit } from "@/lib/event-server";
import { teamPuzzles } from "@/lib/puzzles";
import { blockHash } from "@/lib/hash";
import { stageOpen } from "@/lib/stage-window";

export async function GET(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { data: cfg, error } = await r.db
    .from("stage_config")
    .select("value")
    .eq("key", "stage4")
    .single();
  if (error)
    return NextResponse.json({ error: "Stage lookup failed" }, { status: 500 });
  if (!stageOpen(cfg.value))
    return NextResponse.json({ error: "Stage 4 is closed" }, { status: 423 });
  const p = teamPuzzles(r.team.id, eventKey());
  return NextResponse.json(p.collision);
}

export async function POST(req: Request) {
  return submit(req, 4, (body, team) => {
    const p = teamPuzzles(team, eventKey());
    const a = body.nonce_a,
      b = body.nonce_b;
    if (
      typeof a !== "number" ||
      typeof b !== "number" ||
      !Number.isSafeInteger(a) ||
      !Number.isSafeInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= p.collision.nonce_max ||
      b >= p.collision.nonce_max ||
      a === b
    )
      throw new Error("Send two different integer nonces from 0 to 9999");
    const hashA = blockHash(p.collision.prev, a, p.collision.data),
      hashB = blockHash(p.collision.prev, b, p.collision.data);
    return {
      correct: hashA === p.collision.target && hashB === hashA,
      payload: { nonce_a: a, nonce_b: b, hash_a: hashA, hash_b: hashB },
    };
  });
}
