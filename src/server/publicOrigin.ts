import type { Context } from "hono";

/**
 * Browsers need an absolute, public `https?://host` for OAuth redirects. Request.url can be
 * wrong behind proxies; prefer env or forwarded headers.
 */
export function getPublicRequestOrigin(c: Context): string {
  const explicit =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (explicit) {
    const e = explicit.replace(/\/$/, "");
    if (e.startsWith("http://") || e.startsWith("https://")) return e;
    return `https://${e}`;
  }
  const xfh = c.req.header("x-forwarded-host");
  if (xfh) {
    const xfpRaw = c.req.header("x-forwarded-proto");
    const p = (xfpRaw?.split(",")[0] ?? "https").trim();
    const proto = p === "http" || p === "https" ? p : "https";
    const host = xfh.split(",")[0]!.trim();
    return `${proto}://${host}`;
  }
  try {
    return new URL(c.req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}
