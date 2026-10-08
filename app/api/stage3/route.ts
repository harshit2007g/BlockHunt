import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";


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
  return { db, team };
}

export async function POST(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { db, team } = r;

  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage3").maybeSingle();
  if (!cfg?.value?.open) return NextResponse.json({ error: "Stage 3 is closed" }, { status: 423 });

  const { data: secret } = await db.from("stage_secrets").select("value").eq("key", "stage3").maybeSingle();
  const tamperedAnswer = (secret?.value as { tampered_block?: unknown } | null)?.tampered_block;

  const { data: sc } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
  if (!sc) return NextResponse.json({ error: "No score row" }, { status: 400 });
  if (sc.stage3_base > 0) return NextResponse.json({ error: "Already submitted" }, { status: 409 });

  const body = (await req.json().catch(() => null)) as
    | { tampered_block?: unknown; explanation?: unknown }
    | null;
  const blockId = body?.tampered_block;
  const explanation = typeof body?.explanation === "string" ? body.explanation.trim() : "";

  if (
    typeof blockId !== "number" || !Number.isInteger(blockId) || blockId < 0 || blockId > 1_000_000_000 ||
    !explanation || explanation.length < 30 || explanation.length > 5120
  ) {
    return NextResponse.json(
      { error: "Send tampered_block (int 0..1e9) and explanation (30..5120 chars)" },
      { status: 400 }
    );
  }

  // Atomic attempt claim (mirrors Stage 1): at most 3 guesses with a 60s
  // lockout after each wrong guess.
  const now = new Date();
  const { data: claimed } = await db
    .from("scores")
    .update({ stage3_attempts: (sc.stage3_attempts ?? 0) + 1 })
    .eq("team_id", team.id)
    .eq("stage3_attempts", sc.stage3_attempts ?? 0)
    .lt("stage3_attempts", MAX_GUESSES)
    .or(`stage3_locked_until.is.null,stage3_locked_until.lt.${now.toISOString()}`)
    .select("team_id");
  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
    if (fresh && (fresh.stage3_attempts ?? 0) >= MAX_GUESSES) {
      return NextResponse.json({ error: "No guesses left" }, { status: 429 });
    }
    if (fresh?.stage3_locked_until && new Date(fresh.stage3_locked_until) > new Date()) {
      const secs = Math.ceil((new Date(fresh.stage3_locked_until).getTime() - Date.now()) / 1000);
      return NextResponse.json({ error: `Locked for ${secs}s` }, { status: 429 });
    }
    return NextResponse.json({ error: "Concurrent submission, try again" }, { status: 409 });
  }
  const attempts = (sc.stage3_attempts ?? 0) + 1;

  const correctBlock = blockId === (typeof tamperedAnswer === "number" ? tamperedAnswer : -1);
  const submitAt = new Date();

  await db.from("raw_submissions").insert({
    team_id: team.id,
    stage: 3,
    payload: { tampered_block: blockId, explanation },
    correct: correctBlock,
    awarded: 0,
  });

  const update: Record<string, unknown> = {
    stage3_at: submitAt.toISOString(),
    last_submit_at: submitAt.toISOString(),
  };
  if (!correctBlock) {
    update.stage3_locked_until = new Date(submitAt.getTime() + LOCKOUT_MS).toISOString();
  }

  if (correctBlock) {
    const startedAt = cfg.value.started_at ? new Date(cfg.value.started_at).getTime() : submitAt.getTime();
    const duration = cfg.value.duration_ms ?? 1_800_000;
    const remaining = Math.max(0, 1 - (submitAt.getTime() - startedAt) / duration);
    update.stage3_base = 130;
    update.stage3_bonus = Math.round(20 * remaining);
    // stage3_expl (out of 20) is set by judges in /admin after the rubric pass
  }

  await db.from("scores").update(update).eq("team_id", team.id);

  return NextResponse.json({
    correctBlock,
    awarded: correctBlock ? 130 + (update.stage3_bonus as number) : 0,
    attemptsLeft: MAX_GUESSES - attempts,
    ...(correctBlock
      ? { note: "Explanation goes to the judge rubric; up to 20 more pts for quality." }
      : { note: "Wrong block identified.", lockedUntil: update.stage3_locked_until ?? null }),
  });
}
