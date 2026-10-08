import { blockHash } from "./hash";
import type { PoolBlock } from "./supabase";

/** Recompute a pool block's hash server-side. Never trust the stored flag. */
export function recomputedPoolHash(b: Pick<PoolBlock, "prev_hash" | "nonce" | "data">): string {
  const nonceNum = parseInt(String(b.nonce), 10);
  if (!Number.isFinite(nonceNum)) return "";
  return blockHash((b.prev_hash ?? "").toLowerCase(), nonceNum, b.data ?? "");
}

/** True when the stored hash matches H(prev_hash, nonce, data). */
export function isPoolBlockHashValid(
  b: Pick<PoolBlock, "prev_hash" | "nonce" | "data" | "hash">
): boolean {
  const recomputed = recomputedPoolHash(b);
  return recomputed !== "" && recomputed === (b.hash ?? "").toLowerCase();
}
