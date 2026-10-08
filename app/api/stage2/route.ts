import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { blockHash } from "@/lib/hash";


const NONCE_COOLDOWN_MS = 3_000;

async function requireTeam(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "No token" }, { status: 401 }) };
  const db = supabaseAdmin();
  const { data: ud, error } = await db.auth.getUser(token);
  if (error || !ud.user) return { error: NextResponse.json({ error: "Bad session" }, { status: 401 }) };
  const { data: team } = await db.from("teams").select("*").eq("auth_uid", ud.user.id).maybeSingle();
  if (!team) return { error: NextResponse.json({ error: "No team" }, { status: 403 }) };
  return { db, team };
}

export async function GET(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { db } = r;
  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage2").maybeSingle();
  return NextResponse.json({ config: cfg?.value ?? null });
}

export async function POST(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { db, team } = r;

  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage2").maybeSingle();
  if (!cfg?.value?.open) return NextResponse.json({ error: "Stage 2 is closed" }, { status: 423 });

  const { data: sc } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
  if (!sc) return NextResponse.json({ error: "No score row; ask a volunteer" }, { status: 400 });

  // rate limit: one attempt every 3s per team (timestamp column, not a nonce value)
  const lastAttemptAt: string | null =
    sc.stage2_last_attempt_at ?? sc.stage2_last_nonce ?? null;
  const last = lastAttemptAt ? new Date(lastAttemptAt).getTime() : 0;
  const since = Date.now() - last;
  if (since < NONCE_COOLDOWN_MS) {
    return NextResponse.json(
      { error: `Wait ${Math.ceil((NONCE_COOLDOWN_MS - since) / 1000)}s between attempts` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { nonce?: unknown; block_index?: unknown; prev_hash?: unknown; data?: unknown; parent_block?: unknown }
    | null;
  const nonce = body?.nonce;
  const blockIndex = body?.block_index;
  const prevHash = typeof body?.prev_hash === "string" ? body.prev_hash.trim().toLowerCase() : "";
  const data = typeof body?.data === "string" ? body.data.trim() : "";
  const parentBlockId =
    typeof body?.parent_block === "number" && Number.isInteger(body.parent_block) && body.parent_block > 0
      ? body.parent_block
      : null;

  if (
    typeof nonce !== "number" || !Number.isInteger(nonce) || nonce < 0 || nonce > 1_000_000_000 ||
    typeof blockIndex !== "number" || !Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 1_000_000_000 ||
    !/^[0-9a-f]{8}$/.test(prevHash) || !data || data.length > 2048 ||
    (parentBlockId !== null && parentBlockId > 1_000_000_000)
  ) {
    return NextResponse.json(
      { error: "Send nonce (int 0..1e9), block_index (int 0..1e9), prev_hash (8 hex), data (1..2048 chars)" },
      { status: 400 }
    );
  }

  // nonce_max from seed config is enforced (remove the key to disable the cap)
  const nonceMax = cfg.value.nonce_max;
  if (typeof nonceMax === "number" && Number.isFinite(nonceMax) && nonce >= nonceMax) {
    return NextResponse.json(
      { error: `Nonce must be below the cap (${nonceMax})` },
      { status: 400 }
    );
  }

  const hash = blockHash(prevHash, nonce, data);
  const prefix = cfg.value.difficulty_prefix ?? "00";

  // Atomic cooldown claim: stamp the attempt clock only when no attempt ran
  // in the last 3s. Zero updated rows means another attempt won the race.
  const attemptAt = new Date();
  const cutoff = new Date(attemptAt.getTime() - NONCE_COOLDOWN_MS).toISOString();
  const { data: claimed } = await db
    .from("scores")
    .update({ stage2_last_attempt_at: attemptAt.toISOString() })
    .eq("team_id", team.id)
    .or(`stage2_last_attempt_at.is.null,stage2_last_attempt_at.lt.${cutoff}`)
    .select("team_id");
  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await db
      .from("scores")
      .select("stage2_last_attempt_at")
      .eq("team_id", team.id)
      .maybeSingle();
    const lastMs = fresh?.stage2_last_attempt_at ? new Date(fresh.stage2_last_attempt_at).getTime() : 0;
    const waitMs = NONCE_COOLDOWN_MS - (Date.now() - lastMs);
    return NextResponse.json(
      { error: `Wait ${Math.max(1, Math.ceil(waitMs / 1000))}s between attempts` },
      { status: 429 }
    );
  }

  const meetsTarget = hash.startsWith(prefix);
  if (!meetsTarget) {
    return NextResponse.json({ accepted: false, hash, reason: `hash must start with "${prefix}"` });
  }

  // accepted: insert into the shared mining pool (fork pool for Stage 5).
  // Parent linkage makes longest-chain depth real: prefer the client-declared
  // parent when it matches prev_hash, else resolve by hash lookup. Genesis
  // blocks (prev 00000000) keep parent_block NULL.
  let parentTeam: string | null = null;
  let parentBlock: number | null = null;
  if (parentBlockId !== null) {
    const { data: parent } = await db
      .from("mining_pool")
      .select("id, team_id, hash")
      .eq("id", parentBlockId)
      .maybeSingle();
    if (!parent) {
      return NextResponse.json({ error: "Declared parent_block not found" }, { status: 400 });
    }
    if ((parent.hash as string).toLowerCase() !== prevHash) {
      return NextResponse.json(
        { error: "prev_hash must equal the declared parent block hash" },
        { status: 400 }
      );
    }
    parentBlock = parent.id as number;
    parentTeam = parent.team_id as string;
  } else if (prevHash !== "00000000") {
    const { data: parent } = await db
      .from("mining_pool")
      .select("id, team_id, hash")
      .eq("hash", prevHash)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (parent) {
      parentBlock = parent.id as number;
      parentTeam = parent.team_id as string;
    }
  }

  const { data: inserted, error: insErr } = await db
    .from("mining_pool")
    .insert({
      team_id: team.id,
      block_index: blockIndex,
      nonce: String(nonce),
      hash,
      prev_hash: prevHash,
      data,
      parent_team: parentTeam,
      parent_block: parentBlock,
    })
    .select("id")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // award once: first qualifying block scores base+bonus
  let awarded = 0;
  if (sc.stage2_base === 0) {
    const startedAt = cfg.value.started_at ? new Date(cfg.value.started_at).getTime() : Date.now();
    const duration = cfg.value.duration_ms ?? 2_400_000;
    const remaining = Math.max(0, 1 - (Date.now() - startedAt) / duration);
    const bonus = Math.round(30 * remaining);
    awarded = 150 + bonus;
    await db
      .from("scores")
      .update({ stage2_base: 150, stage2_bonus: bonus, stage2_at: new Date().toISOString(), last_submit_at: new Date().toISOString() })
      .eq("team_id", team.id);
  } else {
    await db
      .from("scores")
      .update({ last_submit_at: new Date().toISOString() })
      .eq("team_id", team.id);
  }

  await db.from("raw_submissions").insert({
    team_id: team.id,
    stage: 2,
    payload: { nonce, block_index: blockIndex, prev_hash: prevHash, data, hash },
    correct: true,
    awarded,
  });

  return NextResponse.json({ accepted: true, hash, pool_id: inserted?.id });
}
