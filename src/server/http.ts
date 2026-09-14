import { NextResponse } from "next/server";

// Shared JSON error response for API routes (Phase 12). The body shape is
// `{ error: string }` so the UI can render a message uniformly.
export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

// The x-user-id header is the mock auth seam for the MVP UI: attribution lives
// in the header/DB row (T12.1), never in a webhook URL/body. Replace with a
// real session when auth lands; every route falls back to 401 here.
export function userIdFrom(request: Request): string | null {
  return request.headers.get("x-user-id");
}