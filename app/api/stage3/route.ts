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
    .eq("key", "stage3")
    .single();
  if (error)
    return NextResponse.json({ error: "Stage lookup failed" }, { status: 500 });
  if (!stageOpen(cfg.value))
    return NextResponse.json({ error: "Stage 3 is closed" }, { status: 423 });
  const p = teamPuzzles(r.team.id, eventKey());
  return NextResponse.json({ blocks: p.evidence });
}

export async function POST(req: Request) {
  return submit(req, 3, (body, team) => {
    const p = teamPuzzles(team, eventKey());
    const block = body.tampered_block;
    const explanation =
      typeof body.explanation === "string" ? body.explanation.trim() : "";
    if (
      !Number.isInteger(block) ||
      Number(block) < 0 ||
      Number(block) > 11 ||
      explanation.length < 30 ||
      explanation.length > 5120
    )
      throw new Error(
        "Choose a block 0..11 and explain your evidence in 30..5120 characters",
      );
    return {
      correct: block === p.tampered,
      payload: { tampered_block: block, explanation },
    };
  });
}
