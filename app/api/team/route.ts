import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const { data: team } = await db
    .from("teams")
    .select("*")
    .eq("auth_uid", userData.user.id)
    .maybeSingle();

  if (!team)
    return NextResponse.json({ error: "No team row" }, { status: 403 });

  const { data: score } = await db
    .from("scores")
    .select("*")
    .eq("team_id", team.id)
    .maybeSingle();

  const { data: subs } = await db
    .from("raw_submissions")
    .select("stage, correct, awarded, created_at")
    .eq("team_id", team.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ team, score, submissions: subs ?? [] });
}

export async function POST(req: Request) {
  // Idempotent ensure-team path: after signup, create the team's row
  // server-side (service role bypasses RLS). The DB trigger creates the
  // scores row; this handler backfills it if the trigger predates the team.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length < 2 || name.length > 40) {
    return NextResponse.json(
      { error: "Pick a team name (2-40 chars)." },
      { status: 400 },
    );
  }

  const { data: existing } = await db
    .from("teams")
    .select("*")
    .eq("auth_uid", userData.user.id)
    .maybeSingle();
  if (existing) {
    await db
      .from("scores")
      .upsert(
        { team_id: existing.id },
        { onConflict: "team_id", ignoreDuplicates: true },
      );
    const { data: score } = await db
      .from("scores")
      .select("*")
      .eq("team_id", existing.id)
      .maybeSingle();
    return NextResponse.json({ team: existing, score, reused: true });
  }

  const { data: created, error: createErr } = await db
    .from("teams")
    .insert({ auth_uid: userData.user.id, name })
    .select("*")
    .single();
  if (createErr) {
    // first-claim-wins: unique(name) race surfaces as a friendly message
    if ((createErr as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That team name is taken. Pick another." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: createErr.message }, { status: 500 });
  }

  // trigger normally creates this; upsert keeps old rows playable
  await db
    .from("scores")
    .upsert(
      { team_id: created.id },
      { onConflict: "team_id", ignoreDuplicates: true },
    );
  const { data: score } = await db
    .from("scores")
    .select("*")
    .eq("team_id", created.id)
    .maybeSingle();
  return NextResponse.json({ team: created, score, reused: false });
}
