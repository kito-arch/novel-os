import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; eventId: string }> },
): Promise<NextResponse> {
  const { id: storyId, eventId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError(400, "invalid JSON body"); }
  if (typeof body !== "object" || body === null) return jsonError(400, "body must be an object");

  const patch = body as Record<string, unknown>;

  if (patch.title !== undefined && (typeof patch.title !== "string" || !patch.title.trim())) {
    return jsonError(400, "title must be a non-empty string");
  }

  await resolveContainer()
    .get("STORY_WORLD_STORE")
    .updateEvent(storyId, eventId, {
      ...(patch.title !== undefined && { title: (patch.title as string).trim() }),
      ...(patch.description !== undefined && { description: (patch.description as string | null) }),
      ...(patch.when !== undefined && { when: patch.when as string | null }),
      ...(patch.settingId !== undefined && { settingId: patch.settingId as string | null }),
      ...(patch.sceneId !== undefined && { sceneId: patch.sceneId as string | null }),
      ...(patch.participants !== undefined && { participants: patch.participants as string[] }),
      ...(patch.involvedObjects !== undefined && { involvedObjects: patch.involvedObjects as string[] }),
      ...(patch.motivation !== undefined && { motivation: patch.motivation as string | null }),
      ...(patch.consequences !== undefined && { consequences: patch.consequences as string[] }),
      ...(patch.confidence !== undefined && { confidence: patch.confidence as string }),
    });

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; eventId: string }> },
): Promise<NextResponse> {
  const { id: storyId, eventId } = await ctx.params;
  await resolveContainer().get("STORY_WORLD_STORE").deleteEvent(storyId, eventId);
  return new NextResponse(null, { status: 204 });
}
