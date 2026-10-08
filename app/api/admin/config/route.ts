import { NextResponse, connection } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";


async function requireAdmin(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "No token" }, { status: 401 }) };
  const db = supabaseAdmin();
  const { data: ud, error } = await db.auth.getUser(token);
  if (error || !ud.user) return { error: NextResponse.json({ error: "Bad session" }, { status: 401 }) };
  const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", ud.user.id).maybeSingle();
  if (!admin) return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  return { db };
}

// Admin-only config surface (service role): stage windows, secrets
// (tampered block, difficulty, contract), finalists, and the team roster
// used to resolve finalist names. Never exposed to team clients.
export async function GET(req: Request) {
  await connection();
  const r = await requireAdmin(req);
  if (r.error) return r.error;
  const { db } = r;

  const { data: configs } = await db.from("stage_config").select("key, value");
  const { data: secrets } = await db.from("stage_secrets").select("key, value");
  const { data: teams } = await db.from("teams").select("id, name").order("name", { ascending: true });

  return NextResponse.json({ configs: configs ?? [], secrets: secrets ?? [], teams: teams ?? [] });
}

export async function POST(req: Request) {
  const r = await requireAdmin(req);
  if (r.error) return r.error;
  const { db } = r;

  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    key?: unknown;
    open?: unknown;
    value?: unknown;
    finalists?: unknown;
  } | null;

  if (body?.action === "stage") {
    if (typeof body.key !== "string") {
      return NextResponse.json({ error: "Send key for the stage action" }, { status: 400 });
    }
    const STAGE_KEYS = ["stage1", "stage2", "stage3", "stage4", "stage5"];
    if (!STAGE_KEYS.includes(body.key)) {
      return NextResponse.json({ error: "Unknown stage key. Use one of: stage1, stage2, stage3, stage4, stage5" }, { status: 400 });
    }
    const { data: cur } = await db.from("stage_config").select("value").eq("key", body.key).maybeSingle();
    const curVal = (cur?.value ?? {}) as Record<string, unknown>;
    if (body.open === true) {
      // Opening stamps a fresh start; re-opening overwrites started_at.
      const next = { ...curVal, open: true, started_at: new Date().toISOString() };
      const { error } = await db.from("stage_config").upsert({ key: body.key, value: next });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, value: next });
    }
    if (body.open === false) {
      const next = { ...curVal, open: false };
      const { error } = await db.from("stage_config").upsert({ key: body.key, value: next });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, value: next });
    }
    return NextResponse.json({ error: "Send open: true/false" }, { status: 400 });
  }

  if (body?.action === "secret") {
    // Tunables and answers. Secrets stay in stage_secrets (service-role only).
    // Non-sensitive tunables (difficulty_prefix, nonce_max) live in stage_config.
    if (typeof body.key !== "string" || typeof body.value !== "object" || body.value === null) {
      return NextResponse.json({ error: "Send key and a value object" }, { status: 400 });
    }
    const v = body.value as Record<string, unknown>;
    if (body.key === "stage3") {
      if (typeof v.tampered_block !== "number" || !Number.isInteger(v.tampered_block) || v.tampered_block < 0) {
        return NextResponse.json({ error: "tampered_block must be an int >= 0" }, { status: 400 });
      }
      const { error } = await db
        .from("stage_secrets")
        .upsert({ key: "stage3", value: { tampered_block: v.tampered_block } });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    if (body.key === "stage2") {
      if (
        (v.difficulty_prefix !== undefined &&
          (typeof v.difficulty_prefix !== "string" || !/^[0-9a-f]{1,8}$/i.test(v.difficulty_prefix))) ||
        (v.nonce_max !== undefined &&
          (typeof v.nonce_max !== "number" || !Number.isInteger(v.nonce_max) || v.nonce_max <= 0))
      ) {
        return NextResponse.json({ error: "difficulty_prefix must be hex, nonce_max a positive int" }, { status: 400 });
      }
      const { data: cur } = await db.from("stage_config").select("value").eq("key", "stage2").maybeSingle();
      const curVal = (cur?.value ?? {}) as Record<string, unknown>;
      if (v.difficulty_prefix !== undefined) curVal.difficulty_prefix = (v.difficulty_prefix as string).toLowerCase();
      if (v.nonce_max !== undefined) curVal.nonce_max = v.nonce_max;
      const { error } = await db.from("stage_config").upsert({ key: "stage2", value: curVal });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, value: curVal });
    }
    if (body.key === "stage4") {
      if (
        (v.contract_address !== undefined && typeof v.contract_address !== "string") ||
        (v.success_code !== undefined && typeof v.success_code !== "string")
      ) {
        return NextResponse.json({ error: "contract_address and success_code must be strings" }, { status: 400 });
      }
      if (
        typeof v.contract_address === "string" &&
        (v.contract_address.length === 0 || v.contract_address.length > 256)
      ) {
        return NextResponse.json({ error: "contract_address must be 1..256 chars" }, { status: 400 });
      }
      if (typeof v.success_code === "string" && v.success_code.length > 256) {
        return NextResponse.json({ error: "success_code must be at most 256 chars" }, { status: 400 });
      }
      const { data: cur } = await db.from("stage_secrets").select("value").eq("key", "stage4").maybeSingle();
      const curVal = (cur?.value ?? {}) as Record<string, unknown>;
      if (v.contract_address !== undefined) curVal.contract_address = v.contract_address;
      if (v.success_code !== undefined) curVal.success_code = v.success_code;
      const { error } = await db.from("stage_secrets").upsert({ key: "stage4", value: curVal });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown secret key" }, { status: 400 });
  }

  if (body?.action === "finalists") {
    // Comma-separated team names resolved server-side to ids.
    if (typeof body.finalists !== "string") {
      return NextResponse.json({ error: "Send finalists as a comma-separated string of team names" }, { status: 400 });
    }
    const names = body.finalists.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0 || names.length > 8) {
      return NextResponse.json({ error: "Send 1..8 team names (rulebook expects 4..6 finalists)" }, { status: 400 });
    }
    const { data: teams } = await db.from("teams").select("id, name");
    const byName = new Map((teams ?? []).map((t) => [(t.name as string).toLowerCase(), t.id as string]));
    const missing: string[] = [];
    const ids: string[] = [];
    for (const n of names) {
      const id = byName.get(n.toLowerCase());
      if (!id) missing.push(n);
      else if (!ids.includes(id)) ids.push(id);
    }
    if (missing.length > 0) {
      return NextResponse.json({ error: `Unknown teams: ${missing.join(", ")}` }, { status: 400 });
    }
    const { data: cur } = await db.from("stage_config").select("value").eq("key", "stage5").maybeSingle();
    const curVal = (cur?.value ?? {}) as Record<string, unknown>;
    curVal.finalists = ids;
    const { error } = await db.from("stage_config").upsert({ key: "stage5", value: curVal });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (ids.length < 4 || ids.length > 6) {
      return NextResponse.json({ ok: true, finalists: names, count: ids.length, warning: "Rulebook expects 4..6 finalists; count is outside that range" });
    }
    return NextResponse.json({ ok: true, finalists: names, count: ids.length });
  }

  return NextResponse.json({ error: "Unknown action (stage, secret, finalists)" }, { status: 400 });
}
