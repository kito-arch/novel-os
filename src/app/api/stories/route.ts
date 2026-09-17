import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { requireAuth } from "@/server/auth";
import { jsonError } from "@/server/http";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const stories = await resolveContainer().get("STORY_WORLD_STORE").listStories(auth.userId);
  return NextResponse.json(stories);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError(400, "invalid JSON"); }
  if (typeof body !== "object" || body === null) return jsonError(400, "body must be an object");
  const { id, title } = body as { id?: string; title?: string };
  if (typeof id !== "string" || !id.trim()) return jsonError(400, "id must be a non-empty string");
  if (typeof title !== "string" || !title.trim()) return jsonError(400, "title must be a non-empty string");
  await resolveContainer().get("STORY_WORLD_STORE").createStory(id.trim(), { title: title.trim(), ownerId: userId });
  return NextResponse.json({ id: id.trim() }, { status: 201 });
}
