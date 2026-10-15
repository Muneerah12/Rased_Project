/**
 * Prototype sign-in, checked in the browser only. It keeps casual viewers out of the demo screens;
 * it is NOT real access control (anyone with the page source can bypass it). Use server-side auth before production.
 * Only a SHA-256 of "user:password" is stored, never the password itself.
 */
const CREDENTIAL_SHA256 = 'aabcabea3561ab3105dbd2156b4f4f9f713162ea29a6fcde5ffcf5a25009f043';
const SESSION_KEY = 'rasid.auth';
export const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

let failures = 0;
let lockedUntil = 0;

export function isSignedIn(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
}

export function signOut() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
}

export type SignInResult = { ok: true } | { ok: false; reason: 'invalid' | 'short' | 'locked'; retryInSec?: number };

export function signIn(user: string, password: string, now = Date.now()): SignInResult {
  if (now < lockedUntil) return { ok: false, reason: 'locked', retryInSec: Math.ceil((lockedUntil - now) / 1000) };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'short' };
  if (sha256(`${user.trim()}:${password}`) !== CREDENTIAL_SHA256) {
    failures += 1;
    if (failures >= MAX_FAILURES) { failures = 0; lockedUntil = now + LOCKOUT_MS; return { ok: false, reason: 'locked', retryInSec: LOCKOUT_MS / 1000 }; }
    return { ok: false, reason: 'invalid' };
  }
  failures = 0;
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* storage unavailable: signed in for this page load only */ }
  return { ok: true };
}

/** Plain SHA-256 (hex). Synchronous and works over http on the LAN, where crypto.subtle is unavailable. */
export function sha256(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(text);
  const len = ((bytes.length + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(len);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const dv = new DataView(msg.buffer);
  dv.setUint32(len - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(len - 4, bits >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}
