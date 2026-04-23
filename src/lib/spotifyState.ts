import { createHmac, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 15 * 60_000;

type StatePayload = { m: string; s: string; t: number; r: string };

function stateSecret(): string {
  return (
    process.env.SPOTIFY_STATE_SECRET ||
    process.env.SPOTIFY_CLIENT_SECRET ||
    ""
  ).trim();
}

export function isSpotifyStateSignable(): boolean {
  return Boolean(stateSecret());
}

/**
 * r = return path, e.g. /squad/{id}/lineup
 */
export function signSpotifyState(
  memberId: string,
  squadId: string,
  returnPath: string
): string {
  const secret = stateSecret();
  if (!secret) throw new Error("missing_spotify_state_secret");
  const t = Date.now();
  const payload: StatePayload = { m: memberId, s: squadId, t, r: returnPath };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const h = createHmac("sha256", secret);
  h.update(b64);
  const sig = h.digest("base64url");
  return `${b64}.${sig}`;
}

export function isSafeSpotifyReturnPath(path: string): boolean {
  if (!path.startsWith("/squad/") || path.includes("..")) return false;
  if (path.includes("[") || path.includes("]") || path.includes("://"))
    return false;
  return true;
}

export function verifySpotifyState(
  s: string
):
  | { memberId: string; squadId: string; returnPath: string }
  | null {
  const secret = stateSecret();
  if (!secret) return null;
  const i = s.indexOf(".");
  if (i < 0) return null;
  const b64 = s.slice(0, i);
  const sig = s.slice(i + 1);
  const h = createHmac("sha256", secret);
  h.update(b64);
  const expected = h.digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8")))
    return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(b64, "base64url").toString("utf8")
    ) as StatePayload;
  } catch {
    return null;
  }
  if (!payload.m || !payload.s || !payload.r) return null;
  if (Date.now() - payload.t > STATE_TTL_MS) return null;
  if (!isSafeSpotifyReturnPath(payload.r)) return null;
  return { memberId: payload.m, squadId: payload.s, returnPath: payload.r };
}
