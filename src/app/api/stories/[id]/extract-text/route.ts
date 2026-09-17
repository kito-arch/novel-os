import { NextResponse, type NextRequest } from "next/server";
import type { ExtractionJob } from "@/container/job-queue";
import { resolveContainer } from "@/server/app-container";
import { jsonError, userIdFrom } from "@/server/http";

// T16.1 — Text-to-extract: same extraction pipeline as audio dictation but no
// STT hop. The transcript arrives directly from the user's textarea. A dictation
// row is created for polling (same GET /api/dictations/[id] endpoint), the
// TranscriptProcessor runs synchronously, and the row is updated to
// completed/failed before the response is sent.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: storyId } = await ctx.params;
  const userId = userIdFrom(request);

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
  const processor = container.get("TRANSCRIPT_PROCESSOR");

  // Resolve scene/chapter context so the LLM can tag events correctly.
  let resolvedSceneId: string | null = sceneId ?? null;
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

  const dictationId = await transcriptStore.saveDictation({
    storyId,
    userId: userId ?? "anonymous",
    transcript,
    wordCount: transcript.split(/\s+/).filter(Boolean).length,
    status: "processing",
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

  try {
    const result = await processor.process(job);
    const summary = result.commitResults[result.commitResults.length - 1] ?? null;
    await transcriptStore.updateDictation(dictationId, {
      status: "completed",
      summary,
      processedAt: new Date(),
    });
  } catch (error) {
    await transcriptStore.updateDictation(dictationId, { status: "failed" });
    console.error("[extract-text] extraction failed:", error);
  }

  return NextResponse.json({ dictationId }, { status: 201 });
}
