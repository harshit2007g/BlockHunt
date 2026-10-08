import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Browser client (RLS applies). */
export function supabaseBrowser() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars"
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

/** Server client lives in ./supabase-admin (server-only guarded). */

// ── row types ──
export type Team = {
  id: string;
  auth_uid: string;
  name: string;
  member_names: string;
  created_at: string;
};

export type Scores = {
  team_id: string;
  stage1_base: number; stage1_bonus: number;
  stage2_base: number; stage2_bonus: number;
  stage3_base: number; stage3_bonus: number; stage3_expl: number;
  stage4_bonus: number;
  stage5_branches: number; stage5_longest: number;
  stage1_at: string | null; stage2_at: string | null; stage3_at: string | null;
  stage4_at: string | null; stage5_at: string | null;
  stage1_attempts: number; stage1_locked_until: string | null;
  stage3_attempts: number; stage3_locked_until: string | null;
  stage4_submitted_at: string | null; stage4_tx_hash: string | null;
  stage2_last_attempt_at: string | null; stage5_attempts: number;
  total: number;
  last_submit_at: string;
};

export type Submission = {
  id: string;
  team_id: string;
  stage: number;
  payload: Record<string, unknown>;
  correct: boolean | null;
  awarded: number;
  created_at: string;
};

export type PoolBlock = {
  id: number;
  team_id: string;
  block_index: number;
  nonce: string;
  hash: string;
  prev_hash: string;
  data: string;
  // uuid columns arrive as strings over the API
  parent_team: string | null;
  parent_block: number | null;
  valid: boolean;
  created_at: string;
};

export type StageConfig = {
  key: string;
  value: {
    open: boolean;
    started_at: string | null;
    duration_ms: number;
    difficulty_prefix?: string;
    nonce_max?: number;
    contract_address?: string;
    success_code?: string;
    finalists?: string[];
  };
};

export type StageStatus = {
  open: boolean;
};
