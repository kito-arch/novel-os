import { NextResponse, type NextRequest } from "next/server";
import type { ExtractionJob } from "@/container/job-queue";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

// Text-to-extract: same async pipeline as audio dictation but with no STT hop.
// The transcript arrives directly from the user's textarea, is saved to DB, and
// an extraction job is enqueued. The client polls status via GET /api/dictations/[id]/stream.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: storyId } = await ctx.params;
  const guard = await storyGuard(request, storyId);
  if (guard instanceof NextResponse) return guard;
  const { userId } = guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "body must be a JSON object");
  }

  const { text, sceneId } = body as { text?: string; sceneId?: string | null };
  if (!text || typeof text !== "string" || !text.trim()) {
    return jsonError(400, "text is required");
  }
  const transcript = text.trim();

  const container = resolveContainer();
  const store = container.get("STORY_WORLD_STORE");
  const transcriptStore = container.get("TRANSCRIPT_STORE");

  // Resolve scene/chapter context so the LLM can tag events correctly.
  const resolvedSceneId: string | null = sceneId ?? null;
  let resolvedChapterId: string | null = null;
  let resolvedSceneTitle: string | null = null;
  let resolvedChapterTitle: string | null = null;
  if (resolvedSceneId) {
    try {
      const scene = await store.getProseScene(storyId, resolvedSceneId);
      if (scene) {
        resolvedSceneTitle = scene.title ?? null;
        resolvedChapterId = scene.chapterId ?? null;
        if (resolvedChapterId) {
          const chapters = await store.listChapters(storyId);
          const chapter = chapters.find((ch) => ch.id === resolvedChapterId);
          resolvedChapterTitle = chapter?.title ?? null;
        }
      }
    } catch {
      // Non-fatal — proceed without context
    }
  }

  // Status starts as "pending" (not "processing") so the SSE stream skips the
  // review stage and waits for the extraction lambda to set "completed".
  const dictationId = await transcriptStore.saveDictation({
    storyId,
    userId,
    transcript,
    wordCount: transcript.split(/\s+/).filter(Boolean).length,
    status: "pending",
  });

  const job: ExtractionJob = {
    dictationId,
    storyId,
    transcript,
    sceneId: resolvedSceneId,
    chapterId: resolvedChapterId,
    sceneTitle: resolvedSceneTitle,
    chapterTitle: resolvedChapterTitle,
  };

  await container.get("EXTRACTION_QUEUE").enqueue("extraction", job);
  return NextResponse.json({ dictationId }, { status: 202 });
}
