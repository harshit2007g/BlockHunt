import { NextResponse } from "next/server";
import { requireTeam, eventKey, submit } from "@/lib/event-server";
import { teamPuzzles } from "@/lib/puzzles";
import { stageOpen } from "@/lib/stage-window";

export async function GET(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { data: cfg, error } = await r.db
    .from("stage_config")
    .select("value")
    .eq("key", "stage1")
    .single();
  if (error)
    return NextResponse.json({ error: "Stage lookup failed" }, { status: 500 });
  if (!stageOpen(cfg.value))
    return NextResponse.json({ error: "Stage 1 is closed" }, { status: 423 });
  const p = teamPuzzles(r.team.id, eventKey());
  return NextResponse.json({ blocks: p.sort });
}

export async function POST(req: Request) {
  return submit(req, 1, (body, team) => {
    const p = teamPuzzles(team, eventKey());
    const order = body.order;
    if (
      !Array.isArray(order) ||
      order.length !== 6 ||
      !order.every((v) => Number.isInteger(v) && v >= 0 && v < 6) ||
      new Set(order).size !== 6
    )
      throw new Error("Send all six block labels once");
    return {
      correct: order.every((v, i) => v === p.order[i]),
      payload: { order },
    };
  });
}
