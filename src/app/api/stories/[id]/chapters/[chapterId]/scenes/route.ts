import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

const CreateSceneSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  position: z.number().int().optional(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; chapterId: string }> },
): Promise<NextResponse> {
  const { id, chapterId } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const parsed = CreateSceneSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "invalid scene data");
  }

  const existing = await store.listProseScenes(id, chapterId);
  const position = parsed.data.position ?? existing.length;
  const sceneId = await store.createProseScene(id, {
    chapterId,
    title: parsed.data.title,
    content: parsed.data.content,
    position,
  });

  const scene = await store.getProseScene(id, sceneId);
  return NextResponse.json(scene, { status: 201 });
}
