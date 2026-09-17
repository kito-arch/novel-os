import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createUser, getUserByEmail, hashPassword, sessionCookie, signJwt } from "@/server/session";
import { jsonError } from "@/server/http";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError(400, "invalid JSON"); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "invalid input");
  }

  const { email, password } = parsed.data;
  const existing = await getUserByEmail(email.toLowerCase());
  if (existing) return jsonError(409, "email already registered");

  const passwordHash = await hashPassword(password);
  const userId = await createUser(email.toLowerCase(), passwordHash);
  const token = signJwt(userId);

  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie(token) } },
  );
}
