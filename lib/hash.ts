// BlockHunt '26 custom hash: deliberately NOT SHA-256, kept simple enough
// to compute by hand with the cheat sheet, but deterministic and server-checked.
//
//   H(prev_hash, nonce, data) = hex string of the steps below, 8 hex digits.
//
// 1. n = integer formed from the last 4 digits of prev_hash (0 if none)
// 2. n = (n * 31 + nonce_digits_sum) mod 65536
// 3. n = (n XOR (data_char_sum mod 65536)) mod 65536
// 4. output = n.toString(16).padStart(4) + ((n * 7919) mod 65536).toString(16).padStart(4)

export const HASH_LEN = 8;

export function blockHash(prevHash: string, nonce: number, data: string): string {
  const digits = prevHash.replace(/\D/g, "");
  let n = digits.length ? parseInt(digits.slice(-4), 10) % 65536 : 0;

  const nonceSum = String(Math.abs(nonce))
    .split("")
    .reduce((a, d) => a + Number(d), 0);
  n = (n * 31 + nonceSum) % 65536;

  let dataSum = 0;
  for (const ch of data) dataSum += ch.charCodeAt(0);
  n = (n ^ (dataSum % 65536)) % 65536;

  const hi = n.toString(16).padStart(4, "0");
  const lo = ((n * 7919) % 65536).toString(16).padStart(4, "0");
  return (hi + lo).toLowerCase();
}
