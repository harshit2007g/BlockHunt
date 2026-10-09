import { blockHash } from "./hash";
import type { PoolBlock } from "./supabase";

export function isPoolBlockHashValid(
  b: Pick<PoolBlock, "prev_hash" | "nonce" | "data" | "hash">,
) {
  const n = Number(b.nonce);
  return (
    /^\d+$/.test(b.nonce) &&
    Number.isSafeInteger(n) &&
    n >= 0 &&
    /^[0-9a-f]{8}$/.test(b.prev_hash) &&
    blockHash(b.prev_hash, n, b.data) === b.hash
  );
}

export function validBranch(ids: number[], byId: Map<number, PoolBlock>) {
  if (!ids.length || new Set(ids).size !== ids.length) return false;
  let parent: number | null = null,
    prev = "00000000";
  for (const id of ids) {
    const b = byId.get(id);
    if (
      !b ||
      !isPoolBlockHashValid(b) ||
      b.parent_block !== parent ||
      b.prev_hash !== prev
    )
      return false;
    parent = id;
    prev = b.hash;
  }
  return true;
}

export function longestChain(pool: PoolBlock[]) {
  const byId = new Map(pool.map((b) => [b.id, b]));
  let longest = 0;
  for (const block of pool) {
    const ids: number[] = [],
      seen = new Set<number>();
    let b: PoolBlock | undefined = block;
    while (b && !seen.has(b.id)) {
      ids.unshift(b.id);
      seen.add(b.id);
      b = b.parent_block === null ? undefined : byId.get(b.parent_block);
    }
    if (validBranch(ids, byId)) longest = Math.max(longest, ids.length);
  }
  return longest;
}

export function scoreBranches(
  pool: PoolBlock[],
  branches: number[][],
  longestIndex: number,
) {
  const byId = new Map(pool.map((b) => [b.id, b]));
  const unique = [
    ...new Map(branches.map((ids) => [ids.join(","), ids])).values(),
  ];
  const validCount = unique.filter((ids) => validBranch(ids, byId)).length;
  const chosen = branches[longestIndex];
  return {
    valid_branches: validCount,
    branch_pts: Math.min(50, validCount * 10),
    longest_pts:
      chosen &&
      validBranch(chosen, byId) &&
      chosen.length === longestChain(pool)
        ? 100
        : 0,
  };
}
