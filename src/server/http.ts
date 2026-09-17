import { NextResponse } from "next/server";

// Shared JSON error response for API routes. The body shape is `{ error: string }`.
export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}
