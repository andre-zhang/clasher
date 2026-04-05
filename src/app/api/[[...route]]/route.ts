import { festivalApiFetch } from "@/server/festivalFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
