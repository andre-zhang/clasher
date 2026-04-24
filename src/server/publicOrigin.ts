import type { Context } from "hono";

/**
 * Public origin for OAuth *redirects back to the browser* must match the site the user is
 * actually on, or `localStorage` (Clasher session) will be on a different origin and
 * `SquadShell` will send them to `/`.
 *
 * Prefer the incoming request’s host (forwarded headers, then URL) over `VERCEL_URL` /
 * `NEXT_PUBLIC_APP_URL`, which may point at a different hostname than the address bar
 * (e.g. custom domain vs `*.vercel.app`).
 */
export function getPublicRequestOrigin(c: Context): string {
  const fromForwarded = (): string | null => {
    const xfh = c.req.header("x-forwarded-host");
    if (xfh) {
      const xfpRaw = c.req.header("x-forwarded-proto");
      const p = (xfpRaw?.split(",")[0] ?? "https").trim();
      const proto = p === "http" || p === "https" ? p : "https";
      const host = xfh.split(",")[0]!.trim();
      return `${proto}://${host}`;
    }
    return null;
  };

  const fromUrl = (): string | null => {
    try {
      return new URL(c.req.url).origin;
    } catch {
      return null;
    }
  };

  const fromEnv = (): string | null => {
    const explicit =
      process.env.PUBLIC_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.VERCEL_URL?.trim();
    if (!explicit) return null;
    const e = explicit.replace(/\/$/, "");
    if (e.startsWith("http://") || e.startsWith("https://")) return e;
    return `https://${e}`;
  };

  return fromForwarded() ?? fromUrl() ?? fromEnv() ?? "http://localhost:3000";
}
