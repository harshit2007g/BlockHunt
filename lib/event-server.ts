import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
import { stageOpen } from "./stage-window";

export function eventKey() {
  const key = process.env.EVENT_SECRET;
  if (!key || key.length < 32)
    throw new Error("EVENT_SECRET must contain at least 32 characters");
  return key;
}

export async function requireTeam(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  const db = supabaseAdmin();
  if (!token)
    return {
      error: NextResponse.json(
        { error: "Log in to your team account" },
        { status: 401 },
      ),
    };
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    return {
      error: NextResponse.json(
        { error: "Session expired, log in again" },
        { status: 401 },
      ),
    };
  const { data: team, error: teamError } = await db
    .from("teams")
    .select("*")
    .eq("auth_uid", data.user.id)
    .maybeSingle();
  if (teamError)
    return {
      error: NextResponse.json(
        { error: "Team lookup failed" },
        { status: 500 },
      ),
    };
  if (!team)
    return {
      error: NextResponse.json(
        { error: "Claim a team name first" },
        { status: 403 },
      ),
    };
  return { db, team };
}

export async function submit(
  req: Request,
  stage: number,
  evaluate: (
    body: Record<string, unknown>,
    team: string,
  ) => { correct: boolean; payload: Record<string, unknown> },
) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "Send a JSON object" }, { status: 400 });
  try {
    const result = evaluate(body, r.team.id);
    const { data, error } = await r.db.rpc("event_submit", {
      p_team: r.team.id,
      p_stage: stage,
      p_correct: result.correct,
      p_payload: result.payload,
    });
    if (error)
      return NextResponse.json(
        { error: "Submission could not be saved" },
        { status: 500 },
      );
    return NextResponse.json(data, { status: data.status ?? 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid submission" },
      { status: 400 },
    );
  }
}

export async function finalistPool(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r;
  const { data: cfg, error } = await r.db
    .from("stage_config")
    .select("value")
    .eq("key", "stage5")
    .single();
  if (error)
    return {
      error: NextResponse.json(
        { error: "Stage lookup failed" },
        { status: 500 },
      ),
    };
  if (!stageOpen(cfg.value))
    return {
      error: NextResponse.json({ error: "Stage 5 is closed" }, { status: 423 }),
    };
  if (!(cfg.value.finalists ?? []).includes(r.team.id))
    return {
      error: NextResponse.json({ error: "Finalists only" }, { status: 403 }),
    };
  const { data: snapshot, error: snapshotError } = await r.db
    .from("stage_secrets")
    .select("value")
    .eq("key", "stage5_pool")
    .single();
  if (snapshotError)
    return {
      error: NextResponse.json(
        { error: "Finale pool not frozen" },
        { status: 503 },
      ),
    };
  return { ...r, pool: snapshot.value.blocks };
}
