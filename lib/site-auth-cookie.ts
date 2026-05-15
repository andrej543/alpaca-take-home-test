const DEFAULT_SITE_PASSWORD = "g9jP{d?x15Qz=-PxkM9R31a8b";

export const SITE_SESSION_COOKIE = "site_session";

/** Default 30 days, aligned with signed expiry inside the cookie value. */
export const SITE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function getSitePassword(): string {
  const fromEnv = process.env.SITE_PASSWORD;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_SITE_PASSWORD;
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i / 2] = byte;
  }
  return out;
}

async function importHmacKey(password: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${password}\0site-auth-cookie-v1`),
  );
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function createSessionToken(password: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SITE_SESSION_TTL_SECONDS;
  const key = await importHmacKey(password);
  const message = new TextEncoder().encode(String(exp));
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return `${exp}.${bytesToHex(sig)}`;
}

export async function verifySessionToken(
  password: string,
  token: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const exp = parseInt(parts[0], 10);
  if (!Number.isFinite(exp)) return false;
  if (exp * 1000 <= Date.now()) return false;

  const sigBytes = hexToBytes(parts[1]);
  if (!sigBytes) return false;

  const key = await importHmacKey(password);
  const message = new TextEncoder().encode(String(exp));
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, message),
  );
  if (sigBytes.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= sigBytes[i] ^ expected[i]!;
  }
  return diff === 0;
}
