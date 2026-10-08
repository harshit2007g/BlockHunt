import { NextResponse } from "next/server";
import { connection } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";


export async function GET() {
  // Live scores: never prerender, always query at request time.
  await connection();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("scores")
    .select(
      `total, last_submit_at,
       stage1_base, stage1_bonus, stage2_base, stage2_bonus,
       stage3_base, stage3_bonus, stage3_expl, stage4_bonus,
       stage5_branches, stage5_longest,
       teams(name)`
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? [])
    .map((r: Record<string, unknown>) => {
      const t = r.teams as { name: string } | null;
      return {
        team: t?.name ?? "?",
        total: Number(r.total ?? 0),
        lastSubmit: String(r.last_submit_at ?? ""),
        stages: {
          s1: Number(r.stage1_base) + Number(r.stage1_bonus),
          s2: Number(r.stage2_base) + Number(r.stage2_bonus),
          s3: Number(r.stage3_base) + Number(r.stage3_bonus) + Number(r.stage3_expl),
          s4: Number(r.stage4_bonus),
          s5: Number(r.stage5_branches) + Number(r.stage5_longest),
        },
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.lastSubmit.localeCompare(b.lastSubmit); // earlier wins ties
    })
    .map((r, i) => ({ rank: i + 1, ...r }));

  return NextResponse.json({ rows });
}
