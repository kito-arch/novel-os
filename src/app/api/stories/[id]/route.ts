import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const world = await resolveContainer().get("STORY_WORLD_STORE").getWorld(id);
  if (!world) return jsonError(404, "story not found");
  return NextResponse.json(world);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError(400, "invalid JSON"); }
  if (typeof body !== "object" || body === null) return jsonError(400, "body must be an object");
  const { title } = body as { title?: string };
  if (typeof title !== "string" || !title.trim()) return jsonError(400, "title must be a non-empty string");
  await resolveContainer().get("STORY_WORLD_STORE").updateStoryTitle(id, title.trim());
  return NextResponse.json({ ok: true });
}