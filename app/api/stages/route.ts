import { NextResponse, connection } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";


// Public status board: open/closed per stage plus the announced Stage 2
// difficulty target. No answers are exposed here; secrets live in
// stage_secrets and are only reachable through the stage routes.
export async function GET() {
  await connection();
  const db = supabaseAdmin();
  const { data, error } = await db.from("stage_config").select("key, value");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byKey = new Map((data ?? []).map((row) => [row.key, row.value as Record<string, unknown>]));
  const open = (k: string) => (byKey.get(k)?.open as boolean) ?? false;
  const s2 = byKey.get("stage2") ?? {};

  return NextResponse.json({
    stages: {
      stage1: { open: open("stage1") },
      stage2: {
        open: open("stage2"),
        difficulty_prefix: typeof s2.difficulty_prefix === "string" ? s2.difficulty_prefix : "00",
      },
      stage3: { open: open("stage3") },
      stage4: { open: open("stage4") },
      stage5: { open: open("stage5") },
    },
  });
}
