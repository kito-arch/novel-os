import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

function buildSnippet(content: string, entityId: string): string | null {
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(content)) !== null) {
    if (m[2] !== entityId) continue;
    const start = Math.max(0, m.index - 70);
    const end = Math.min(content.length, m.index + m[0].length + 70);
    // Replace all mention markers in the snippet with just @Name for readability
    let snippet = content
      .slice(start, end)
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1")
      .replace(/\n+/g, " ");
    if (start > 0) snippet = "…" + snippet;
    if (end < content.length) snippet += "…";
    return snippet;
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; entityId: string }> },
): Promise<NextResponse> {
  const { id, entityId } = await ctx.params;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  const [scenes, chapters] = await Promise.all([
    store.listProseScenes(id),
    store.listChapters(id),
  ]);

  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  const references = [];
  for (const scene of scenes) {
    if (!scene.content?.includes(`(${entityId})`)) continue;
    const snippet = buildSnippet(scene.content, entityId);
    if (!snippet) continue;
    const chapter = scene.chapterId ? chapterById.get(scene.chapterId) : undefined;
    references.push({
      sceneId: scene.id,
      sceneTitle: scene.title ?? null,
      chapterId: scene.chapterId ?? null,
      chapterTitle: chapter?.title ?? null,
      snippet,
    });
  }

  return NextResponse.json(references);
}
