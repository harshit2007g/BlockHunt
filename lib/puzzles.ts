import { createHmac } from "node:crypto";
import { blockHash } from "./hash";

export type PuzzleBlock = {
  index: number;
  chain: string;
  prev: string;
  nonce: number;
  data: string;
  hash: string;
};

function digest(key: string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function teamPuzzles(team: string, key: string) {
  const seed = digest(key, `puzzles:${team}`);
  let cursor = 0;
  const next = () => parseInt(digest(seed, String(cursor++)).slice(0, 8), 16);
  const labels = Array.from({ length: 6 }, (_, i) => i);
  for (let i = 5; i > 0; i--) {
    const j = next() % (i + 1);
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  if (labels.every((n, i) => n === i))
    [labels[0], labels[1]] = [labels[1], labels[0]];
  const chain = (name: string, ids: number[]) => {
    let prev = "00000000";
    const hashes = new Set<string>();
    return ids.map((index) => {
      const nonce = next() % 10000;
      let data = `${name}-${seed.slice(0, 12)}-${next() % 10000}`;
      let hash = blockHash(prev, nonce, data);
      // The teaching hash is weak; avoid ambiguous links in sorting puzzles.
      while (hash === "00000000" || hashes.has(hash)) {
        data += "~";
        hash = blockHash(prev, nonce, data);
      }
      hashes.add(hash);
      const b = { index, chain: name, prev, nonce, data, hash };
      prev = hash;
      return b;
    });
  };
  const sort = chain("sort", labels);
  const evidence = [
    ...chain("A", [0, 1, 2, 3, 4, 5]),
    ...chain("B", [6, 7, 8, 9, 10, 11]),
  ];
  const tampered = 1 + (next() % 10);
  evidence[tampered].data += "!";
  const collisionData = `collision-${seed.slice(12, 24)}`;
  const collisionNonce = 12 + (next() % 77);
  return {
    sort: sort.sort((a, b) => a.index - b.index),
    order: labels,
    evidence,
    tampered,
    collision: {
      data: collisionData,
      prev: "00000000",
      target: blockHash("00000000", collisionNonce, collisionData),
      nonce_max: 10000,
    },
  };
}

export function miningChallenge(
  team: string,
  round: number,
  parent: number | null,
  prev: string,
  key: string,
) {
  const id = digest(
    key,
    `mine:${team}:${round}:${parent ?? "genesis"}:${prev}`,
  );
  return {
    id,
    round,
    parent_block: parent,
    prev_hash: prev,
    data: `mine-${id.slice(0, 16)}`,
  };
}

export function miningProof(challenge: string, nonce: number, key: string) {
  return digest(key, `${challenge}:${nonce}`);
}
