import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

const PatchSceneSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  position: z.number().int().optional(),
});

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; sceneId: string }> },
): Promise<NextResponse> {
  const { id, sceneId } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");
  const scene = await store.getProseScene(id, sceneId);
  if (!scene) return jsonError(404, "scene not found");
  return NextResponse.json(scene);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; sceneId: string }> },
): Promise<NextResponse> {
  const { id, sceneId } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const parsed = PatchSceneSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "invalid patch");
  }

  await store.updateProseScene(id, sceneId, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; sceneId: string }> },
): Promise<NextResponse> {
  const { id, sceneId } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");
  await store.deleteProseScene(id, sceneId);
  return NextResponse.json({ ok: true });
}
