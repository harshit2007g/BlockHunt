import { NextResponse } from "next/server";
import { eventKey, requireTeam } from "@/lib/event-server";
import { miningChallenge, miningProof } from "@/lib/puzzles";
import { blockHash } from "@/lib/hash";
import { stageOpen } from "@/lib/stage-window";

async function challenge(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r;
  const { data: cfg, error: cfgError } = await r.db
    .from("stage_config")
    .select("value")
    .eq("key", "stage2")
    .single();
  if (cfgError)
    return {
      error: NextResponse.json(
        { error: "Stage lookup failed" },
        { status: 500 },
      ),
    };
  if (!stageOpen(cfg.value))
    return {
      error: NextResponse.json({ error: "Stage 2 is closed" }, { status: 423 }),
    };
  const { data: sc, error: scError } = await r.db
    .from("scores")
    .select("mining_round")
    .eq("team_id", r.team.id)
    .single();
  if (scError)
    return {
      error: NextResponse.json(
        { error: "Score lookup failed" },
        { status: 500 },
      ),
    };
  const parentInput = new URL(req.url).searchParams.get("parent");
  const parentId = parentInput ? Number(parentInput) : null;
  let prev = "00000000";
  if (parentId !== null) {
    if (!Number.isSafeInteger(parentId) || parentId <= 0)
      return {
        error: NextResponse.json({ error: "Invalid parent" }, { status: 400 }),
      };
    const { data: parent } = await r.db
      .from("mining_pool")
      .select("hash")
      .eq("id", parentId)
      .eq("team_id", r.team.id)
      .maybeSingle();
    if (!parent)
      return {
        error: NextResponse.json(
          { error: "Choose one of your accepted blocks" },
          { status: 400 },
        ),
      };
    prev = parent.hash;
  }
  return {
    ...r,
    config: cfg.value,
    challenge: miningChallenge(
      r.team.id,
      sc.mining_round,
      parentId,
      prev,
      eventKey(),
    ),
  };
}

export async function GET(req: Request) {
  const r = await challenge(req);
  if (r.error) return r.error;
  const { data: blocks, error } = await r.db
    .from("mining_pool")
    .select("id,hash,parent_block")
    .eq("team_id", r.team.id)
    .order("id");
  if (error)
    return NextResponse.json({ error: "Pool lookup failed" }, { status: 500 });
  return NextResponse.json({
    challenge: r.challenge,
    config: r.config,
    blocks,
  });
}

export async function POST(req: Request) {
  const r = await challenge(req);
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  const nonce = body?.nonce;
  if (
    typeof nonce !== "number" ||
    !Number.isSafeInteger(nonce) ||
    nonce < 0 ||
    nonce > 1000000000 ||
    (r.config.nonce_max != null && nonce >= r.config.nonce_max)
  )
    return NextResponse.json(
      { error: "Nonce outside the allowed range" },
      { status: 400 },
    );
  if (body?.challenge_id !== r.challenge.id)
    return NextResponse.json(
      { error: "Challenge changed; reload before trying again" },
      { status: 409 },
    );
  const proof = miningProof(r.challenge.id, nonce, eventKey());
  const hash = blockHash(r.challenge.prev_hash, nonce, r.challenge.data);
  const { data, error } = await r.db.rpc("event_submit", {
    p_team: r.team.id,
    p_stage: 2,
    p_correct: proof.startsWith(r.config.difficulty_prefix ?? "0"),
    p_payload: {
      ...r.challenge,
      nonce,
      hash,
      proof,
      prefix: r.config.difficulty_prefix ?? "0",
    },
  });
  if (error)
    return NextResponse.json(
      { error: "Attempt could not be saved" },
      { status: 500 },
    );
  return NextResponse.json(
    { ...data, hash, proof },
    { status: data.status ?? 200 },
  );
}
