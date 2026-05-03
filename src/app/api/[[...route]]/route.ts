import { festivalApiFetch } from "@/server/festivalFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Setlist preview walks setlist.fm sequentially (~1s between calls); large selections need minutes. */
export const maxDuration = 300;

export function GET(request: Request) {
  return festivalApiFetch(request);
}

export function POST(request: Request) {
  return festivalApiFetch(request);
}

export function PUT(request: Request) {
  return festivalApiFetch(request);
}

export function PATCH(request: Request) {
  return festivalApiFetch(request);
}

export function DELETE(request: Request) {
  return festivalApiFetch(request);
}

export function OPTIONS(request: Request) {
  return festivalApiFetch(request);
}
