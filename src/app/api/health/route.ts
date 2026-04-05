import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit route so /api/health always resolves in production. */
export function GET() {
  return NextResponse.json({ ok: true });
}
