import { NextResponse } from "next/server";
import { finalistPool } from "@/lib/event-server";
import { scoreBranches } from "@/lib/chain";

export async function POST(req: Request) {
  const r = await finalistPool(req);
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  if (
    !Array.isArray(body?.branches) ||
    !body.branches.length ||
    body.branches.length > 20 ||
    !body.branches.every(
      (b: { block_ids?: unknown }) =>
        Array.isArray(b?.block_ids) &&
        b.block_ids.length > 0 &&
        b.block_ids.length <= 200 &&
        b.block_ids.every(
          (id: unknown) =>
            typeof id === "number" && Number.isSafeInteger(id) && id > 0,
        ),
    )
  )
    return NextResponse.json(
      { error: "Send 1..20 branches with 1..200 positive block IDs each" },
      { status: 400 },
    );
  const index = body.longest_branch_index;
  if (!Number.isInteger(index) || index < 0 || index >= body.branches.length)
    return NextResponse.json(
      { error: "Choose a valid longest branch index" },
      { status: 400 },
    );
  const branches: number[][] = body.branches.map(
    (b: { block_ids: number[] }) => b.block_ids,
  );
  const score = scoreBranches(r.pool, branches, index);
  const { data, error } = await r.db.rpc("event_submit", {
    p_team: r.team.id,
    p_stage: 5,
    p_correct: score.longest_pts > 0,
    p_payload: { branches, longest_branch_index: index, ...score },
  });
  if (error)
    return NextResponse.json(
      { error: "Finale could not be saved" },
      { status: 500 },
    );
  return NextResponse.json(data, { status: data.status ?? 200 });
}
