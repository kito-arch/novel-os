import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie } from "@/server/session";

export async function POST(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookie() } },
  );
}
