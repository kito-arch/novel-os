import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

const CreateChapterSchema = z.object({
  title: z.string().min(1),
  position: z.number().int().optional(),
});

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");
  const chapterList = await store.listChapters(id);
  const scenes = await store.listProseScenes(id);
  const result = chapterList.map((chapter) => ({
    ...chapter,
    scenes: scenes
      .filter((s) => s.chapterId === chapter.id)
      .map(({ content: _content, ...rest }) => rest),
  }));
  return NextResponse.json(result);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const parsed = CreateChapterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "invalid chapter data");
  }

  const existingChapters = await store.listChapters(id);
  const position = parsed.data.position ?? existingChapters.length;
  const chapterId = await store.createChapter(id, { title: parsed.data.title, position });

  return NextResponse.json({ id: chapterId }, { status: 201 });
}
