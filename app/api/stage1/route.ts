import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { blockHash } from "@/lib/hash";


// Stage 1 puzzle: block definitions. The prev links below are DERIVED at
// module load by chaining blockHash, so the server validates a real chain:
// each block's prev must equal the previous block's computed hash,
// starting from the genesis prev "00000000".
const STAGE1_DEFS = [
  { index: 0, nonce: 4821, data: "genesis-lh9" },
  { index: 1, nonce: 7163, data: "sort-the-chain" },
  { index: 2, nonce: 2940, data: "catch-the-forger" },
  { index: 3, nonce: 5127, data: "consensus-finale" },
];

const GENESIS_PREV = "00000000";

const CHAIN: { index: number; prev: string; nonce: number; data: string; hash: string }[] = (() => {
  let prev = GENESIS_PREV;
  return STAGE1_DEFS.map((b) => {
    const hash = blockHash(prev, b.nonce, b.data);
    const entry = { ...b, prev, hash };
    prev = hash;
    return entry;
  });
})();

const CORRECT_ORDER = [0, 1, 2, 3];
const MAX_GUESSES = 3;
const LOCKOUT_MS = 60_000;

async function requireTeam(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "No token" }, { status: 401 }) };
  const db = supabaseAdmin();
  const { data: ud, error } = await db.auth.getUser(token);
  if (error || !ud.user) return { error: NextResponse.json({ error: "Bad session" }, { status: 401 }) };
  const { data: team } = await db.from("teams").select("*").eq("auth_uid", ud.user.id).maybeSingle();
  if (!team) return { error: NextResponse.json({ error: "No team" }, { status: 403 }) };
  return { db, team, userId: ud.user.id };
}

export async function POST(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { db, team } = r;

  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage1").maybeSingle();
  if (!cfg?.value?.open) return NextResponse.json({ error: "Stage 1 is closed" }, { status: 423 });

  const { data: sc } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
  if (!sc) return NextResponse.json({ error: "No score row; ask a volunteer" }, { status: 400 });
  if (sc.stage1_base > 0) return NextResponse.json({ error: "Already solved" }, { status: 409 });
  if (sc.stage1_attempts >= MAX_GUESSES) {
    return NextResponse.json({ error: "No guesses left" }, { status: 429 });
  }
  if (sc.stage1_locked_until && new Date(sc.stage1_locked_until) > new Date()) {
    const secs = Math.ceil((new Date(sc.stage1_locked_until).getTime() - Date.now()) / 1000);
    return NextResponse.json({ error: `Locked for ${secs}s` }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;
  const order = body?.order;
  if (
    !Array.isArray(order) ||
    order.length !== CORRECT_ORDER.length ||
    !order.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < CHAIN.length)
  ) {
    return NextResponse.json(
      { error: `Send order as an array of ${CORRECT_ORDER.length} block indexes (ints 0-${CHAIN.length - 1})` },
      { status: 400 }
    );
  }

  // Atomic attempt claim: increment only when the row still shows the attempt
  // count we read, fewer than MAX_GUESSES were used, and no lockout is active.
  // Zero updated rows means rejected (exhausted, locked, or a concurrent race).
  const now = new Date();
  const { data: claimed } = await db
    .from("scores")
    .update({ stage1_attempts: sc.stage1_attempts + 1 })
    .eq("team_id", team.id)
    .eq("stage1_attempts", sc.stage1_attempts)
    .lt("stage1_attempts", MAX_GUESSES)
    .or(`stage1_locked_until.is.null,stage1_locked_until.lt.${now.toISOString()}`)
    .select("team_id");
  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
    if (fresh && fresh.stage1_attempts >= MAX_GUESSES) {
      return NextResponse.json({ error: "No guesses left" }, { status: 429 });
    }
    if (fresh?.stage1_locked_until && new Date(fresh.stage1_locked_until) > new Date()) {
      const secs = Math.ceil((new Date(fresh.stage1_locked_until).getTime() - Date.now()) / 1000);
      return NextResponse.json({ error: `Locked for ${secs}s` }, { status: 429 });
    }
    return NextResponse.json({ error: "Concurrent submission, try again" }, { status: 409 });
  }
  const attempts = sc.stage1_attempts + 1;

  // Real chain check: the submitted order must be a permutation of the block
  // indexes where the first block starts at genesis and every later block's
  // stored prev equals the recomputed hash of its predecessor.
  const orderArr = order as number[];
  const byIndex = new Map(CHAIN.map((b) => [b.index, b]));
  let correct = orderArr.length === CHAIN.length;
  if (correct) {
    const seen = new Set<number>();
    let prevHash: string | null = null;
    for (const idx of orderArr) {
      const block = byIndex.get(idx);
      if (!block || seen.has(idx)) {
        correct = false;
        break;
      }
      seen.add(idx);
      const recomputedPrev = block.prev.toLowerCase();
      // sanity: stored prev must match the hash formula chain position
      const expectedPrev = prevHash === null ? GENESIS_PREV : prevHash;
      if (recomputedPrev !== expectedPrev) {
        correct = false;
        break;
      }
      // sanity: the block hash itself must be well formed via blockHash
      const recomputedHash = blockHash(block.prev, block.nonce, block.data);
      if (recomputedHash !== block.hash || recomputedHash.length !== 8) {
        correct = false;
        break;
      }
      prevHash = recomputedHash;
    }
    // the only order satisfying the linkage above is CORRECT_ORDER, but the
    // check stays structural so card changes cannot silently pass.
    if (correct && !orderArr.every((v, i) => v === CORRECT_ORDER[i])) {
      correct = false;
    }
  }

  const now2 = new Date();
  const update: Record<string, unknown> = {
    last_submit_at: now2.toISOString(),
  };

  if (!correct) update.stage1_locked_until = new Date(now2.getTime() + LOCKOUT_MS).toISOString();

  await db.from("raw_submissions").insert({
    team_id: team.id,
    stage: 1,
    payload: { order: orderArr },
    correct,
    awarded: 0,
  });

  if (correct) {
    const startedAt = cfg.value.started_at ? new Date(cfg.value.started_at).getTime() : now2.getTime();
    const duration = cfg.value.duration_ms ?? 900_000;
    const remaining = Math.max(0, 1 - (now2.getTime() - startedAt) / duration); // 0..1
    const bonus = Math.round(20 * remaining);
    update.stage1_base = 100;
    update.stage1_bonus = bonus;
    update.stage1_at = now2.toISOString();
  }

  await db.from("scores").update(update).eq("team_id", team.id);

  return NextResponse.json({
    correct,
    attemptsLeft: MAX_GUESSES - attempts,
    ...(correct ? { awarded: 100 + (update.stage1_bonus as number) } : { lockedUntil: update.stage1_locked_until ?? null }),
  });
}
