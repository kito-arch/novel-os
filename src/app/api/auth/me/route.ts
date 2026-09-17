import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "../../../../../drizzle/schema";
import { getDb } from "@/server/db";
import { getSessionUserId } from "@/server/session";
import { jsonError } from "@/server/http";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "not authenticated");

  const user = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, createdAt: true },
  });
  if (!user) return jsonError(401, "not authenticated");

  return NextResponse.json(user);
}
