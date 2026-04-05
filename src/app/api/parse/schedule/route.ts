import { festivalApiFetch } from "@/server/festivalFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return festivalApiFetch(request);
}
