import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: storyId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError(400, "invalid JSON body"); }
  if (typeof body !== "object" || body === null) return jsonError(400, "body must be an object");

  const data = body as Record<string, unknown>;

  if (typeof data.title !== "string" || !data.title.trim()) {
    return jsonError(400, "title is required");
  }

  const validConfidence = ["explicit", "implied", "inferred", "unknown"];
  const confidence = typeof data.confidence === "string" && validConfidence.includes(data.confidence)
    ? data.confidence
    : "explicit";

  const id = await resolveContainer()
    .get("STORY_WORLD_STORE")
    .createEvent(storyId, {
      title: (data.title as string).trim(),
      confidence,
      description: (data.description as string | null | undefined) ?? null,
      when: (data.when as string | null | undefined) ?? null,
      settingId: (data.settingId as string | null | undefined) ?? null,
      sceneId: (data.sceneId as string | null | undefined) ?? null,
      participants: (data.participants as string[] | undefined) ?? [],
      involvedObjects: (data.involvedObjects as string[] | undefined) ?? [],
      motivation: (data.motivation as string | null | undefined) ?? null,
      consequences: (data.consequences as string[] | undefined) ?? [],
    });

  return NextResponse.json({ id }, { status: 201 });
}
