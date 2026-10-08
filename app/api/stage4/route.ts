import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";


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
  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage4").maybeSingle();
  const { data: secret } = await db.from("stage_secrets").select("value").eq("key", "stage4").maybeSingle();
  const contract = (secret?.value as { contract_address?: unknown } | null)?.contract_address;
  // expose contract address publicly to logged-in teams, never the success code
  return NextResponse.json({
    open: cfg?.value?.open ?? false,
    contract_address: typeof contract === "string" ? contract : "",
  });
}

export async function POST(req: Request) {
  const r = await requireTeam(req);
  if (r.error) return r.error;
  const { db, team } = r;

  const { data: cfg } = await db.from("stage_config").select("value").eq("key", "stage4").maybeSingle();
  if (!cfg?.value?.open) return NextResponse.json({ error: "Stage 4 is closed" }, { status: 423 });

  const { data: sc } = await db.from("scores").select("*").eq("team_id", team.id).maybeSingle();
  if (!sc) return NextResponse.json({ error: "No score row" }, { status: 400 });
  if (sc.stage4_submitted_at || sc.stage4_bonus > 0) {
    return NextResponse.json({ error: "Already submitted, waiting for verification" }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { tx_hash?: unknown } | null;
  const txHash = typeof body?.tx_hash === "string" ? body.tx_hash.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Send tx_hash as 0x + 64 hex chars" }, { status: 400 });
  }

  // reject already-seen hashes (each transaction counts for one team only)
  const { data: seen } = await db
    .from("raw_submissions")
    .select("id")
    .eq("stage", 4)
    .eq("payload->>tx_hash", txHash)
    .limit(1);
  if (seen && seen.length > 0) {
    return NextResponse.json({ error: "This transaction hash was already submitted" }, { status: 409 });
  }

  await db.from("raw_submissions").insert({
    team_id: team.id,
    stage: 4,
    payload: { tx_hash: txHash },
    correct: null, // verified by coordinator against the success code, then confirmed in /admin
    awarded: 0,
  });

  // Atomic first-submit claim: the unique stage4_tx_hash guard turns a
  // same-hash race into a 409 instead of a double count.
  const now = new Date();
  const { data: claimed, error: claimErr } = await db
    .from("scores")
    .update({
      stage4_submitted_at: now.toISOString(),
      stage4_tx_hash: txHash,
      stage4_at: now.toISOString(),
      last_submit_at: now.toISOString(),
    })
    .eq("team_id", team.id)
    .is("stage4_submitted_at", null)
    .select("team_id");
  if (claimErr) {
    if ((claimErr as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "This transaction hash was already submitted" }, { status: 409 });
    }
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "Already submitted, waiting for verification" }, { status: 409 });
  }

  return NextResponse.json({
    received: true,
    note: "Submitted and pending verification. A volunteer checks the transaction, then your +50 is confirmed on the leaderboard.",
  });
}
