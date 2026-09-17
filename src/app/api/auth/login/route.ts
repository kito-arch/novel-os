import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUserByEmail, sessionCookie, signJwt, verifyPassword } from "@/server/session";
import { jsonError } from "@/server/http";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError(400, "invalid JSON"); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(400, "email and password are required");

  const { email, password } = parsed.data;
  const user = await getUserByEmail(email.toLowerCase());
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return jsonError(401, "invalid email or password");
  }

  const token = signJwt(user.id);
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie(token) } },
  );
}
