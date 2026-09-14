import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

const PatchChapterSchema = z.object({
  title: z.string().min(1).optional(),
  position: z.number().int().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; chapterId: string }> },
): Promise<NextResponse> {
  const { id, chapterId } = await ctx.params;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const parsed = PatchChapterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "invalid patch");
  }

  await store.updateChapter(id, chapterId, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; chapterId: string }> },
): Promise<NextResponse> {
  const { id, chapterId } = await ctx.params;
  const store = resolveContainer().get("STORY_WORLD_STORE");
  await store.deleteChapter(id, chapterId);
  return NextResponse.json({ ok: true });
}
