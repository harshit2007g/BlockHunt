import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { PoolBlock } from "@/lib/supabase";
import { isPoolBlockHashValid } from "@/lib/chain";


const MAX_BRANCHES = 20;
const MAX_IDS_PER_BRANCH = 200;

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

type BranchInput = { block_ids: unknown };

/** A submitted branch is valid only when every block id resolves to a pool
 *  block whose stored hash matches H(prev_hash, nonce, data) recomputed
 *  server-side, with unbroken prev_hash continuity from genesis. */
function isBranchValid(
  ids: number[],
  byId: Map<number, PoolBlock>,
  hashValid: Map<number, boolean>
): boolean {
  if (ids.length === 0) return false;
  let prevHash = "00000000"; // genesis convention used by Stage 2 cards
  for (const id of ids) {
    const b = byId.get(id);
    if (!b || hashValid.get(b.id) !== true) return false;
    if (b.prev_hash.toLowerCase() !== prevHash.slice(0, 8).toLowerCase()) return false;
    prevHash = b.hash;
  }
  return true;
}

export async function POST(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { db, team } = r;

  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage5").maybeSingle();
  if (!cfg?.value?.open) return NextResponse.json({ error: "Stage 5 is closed" }, { status: 423 });

  // Finalists only: the organizer sets the list in /admin after S3+S4.
  const finalists = (cfg.value as { finalists?: unknown }).finalists;
  if (!Array.isArray(finalists) || finalists.length === 0) {
    return NextResponse.json({ error: "Finalists are not announced yet" }, { status: 423 });
  }
  if (!finalists.includes(team.id)) {
    return NextResponse.json({ error: "Stage 5 is for finalist teams only" }, { status: 403 });
  }

  const { data: sc } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
  if (!sc) return NextResponse.json({ error: "No score row" }, { status: 400 });
  if (sc.stage5_attempts >= 1) return NextResponse.json({ error: "One submission only" }, { status: 409 });

  const body = (await req.json().catch(() => null)) as
    | { branches?: unknown; longest_branch_index?: unknown }
    | null;
  if (!Array.isArray(body?.branches) || body.branches.length === 0 || body.branches.length > MAX_BRANCHES) {
    return NextResponse.json(
      { error: `Send 1..${MAX_BRANCHES} branches: [{block_ids: number[]}]` },
      { status: 400 }
    );
  }
  const branches = body.branches as BranchInput[];
  const longestIdx = body.longest_branch_index;
  if (
    typeof longestIdx !== "number" ||
    !Number.isInteger(longestIdx) ||
    longestIdx < 0 ||
    longestIdx >= branches.length
  ) {
    return NextResponse.json(
      { error: "longest_branch_index must be an in-range integer" },
      { status: 400 }
    );
  }
  const parsed: number[][] = [];
  for (const br of branches) {
    const ids = (br as { block_ids?: unknown }).block_ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_IDS_PER_BRANCH ||
      !ids.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 1_000_000_000)
    ) {
      return NextResponse.json(
        { error: `Each branch needs 1..${MAX_IDS_PER_BRANCH} positive integer block ids` },
        { status: 400 }
      );
    }
    parsed.push(ids as number[]);
  }

  // Dedupe branches by exact ordered-id sequence: different orderings are
  // different branches, and the validity check rejects scrambled ones.
  const seenSigs = new Set<string>();
  const unique: number[][] = [];
  const uniqueIdx: number[] = [];
  parsed.forEach((ids, i) => {
    const sig = ids.join(",");
    if (!seenSigs.has(sig)) {
      seenSigs.add(sig);
      unique.push(ids);
      uniqueIdx.push(i);
    }
  });

  // Ground truth from the pool. A block counts only when its stored hash
  // equals H(prev_hash, nonce, data) recomputed server-side. The stored
  // valid flag is informational and is never trusted here. Parent linkage
  // (parent_block set at Stage 2 insert time) drives longest-chain depth.
  const { data: pool, error: poolErr } = await db.from("mining_pool").select("*").returns<PoolBlock[]>();
  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });

  // Rulebook: only finalists' blocks count. Non-finalist pool blocks are
  // excluded from branch validation and longest-chain computation.
  const finalistSet = new Set(finalists as string[]);
  const fpool = (pool ?? []).filter((b) => finalistSet.has(b.team_id));

  const hashValid = new Map<number, boolean>();
  for (const b of fpool) hashValid.set(b.id, isPoolBlockHashValid(b));
  const isValid = (b: PoolBlock) => hashValid.get(b.id) === true;

  const byId = new Map(fpool.map((b) => [b.id, b]));
  const childrenOf = new Map<number | null, PoolBlock[]>();
  for (const b of fpool) {
    if (!isValid(b)) continue;
    const key = b.parent_block;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(b);
  }

  // longest valid chain by walking children links from genesis blocks
  function depth(b: PoolBlock, seen: Set<number> = new Set<number>()): number {
    if (seen.has(b.id)) return 0;
    seen.add(b.id);
    const kids = childrenOf.get(b.id) ?? [];
    return 1 + Math.max(0, ...kids.map((k) => depth(k, seen)));
  }
  const genesis = fpool.filter((b) => isValid(b) && b.parent_block === null);
  const trueLongest = Math.max(0, ...genesis.map((b) => depth(b)));

  const validity = unique.map((ids) => isBranchValid(ids, byId, hashValid));
  const validCount = validity.filter(Boolean).length;

  const branchPts = Math.min(50, validCount * 10);
  // The longest pick scores only when that branch itself re-verifies AND its
  // length matches the true longest chain. An empty pool (trueLongest 0)
  // can never award the +100 because branches must be non-empty.
  const longestPos = uniqueIdx.indexOf(longestIdx);
  const longestBranchValid = longestPos >= 0 && validity[longestPos];
  const longestLen = longestPos >= 0 ? unique[longestPos].length : -1;
  const longestCorrect = longestBranchValid && trueLongest > 0 && longestLen === trueLongest;
  const longestPts = longestCorrect ? 100 : 0;
  const now = new Date();

  await db.from("raw_submissions").insert({
    team_id: team.id,
    stage: 5,
    payload: { branches: parsed, longest_branch_index: longestIdx, trueLongest },
    correct: longestCorrect,
    awarded: branchPts + longestPts,
  });

  // Atomic one-submission claim: zero updated rows means a concurrent
  // submission already consumed the single attempt.
  const { data: claimed } = await db
    .from("scores")
    .update({
      stage5_branches: branchPts,
      stage5_longest: longestPts,
      stage5_at: now.toISOString(),
      stage5_attempts: 1,
      last_submit_at: now.toISOString(),
    })
    .eq("team_id", team.id)
    .eq("stage5_attempts", 0)
    .select("team_id");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "One submission only" }, { status: 409 });
  }

  return NextResponse.json({ valid_branches: validCount, branch_pts: branchPts, longest_pts: longestPts });
}
