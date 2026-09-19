import { NextResponse, type NextRequest } from "next/server";
import type { ExtractionJob } from "@/container/job-queue";
import { resolveContainer } from "@/server/app-container";
import { requireAuth } from "@/server/auth";
import { jsonError } from "@/server/http";

// User-triggered extraction for an audio dictation that has been transcribed.
// The client may submit an edited transcript; if omitted the stored transcript
// is used. Enqueues an "extraction" job and returns 202 — the result arrives
// via GET /api/dictations/[id]/stream once the worker completes.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { id: dictationId } = await ctx.params;
  const container = resolveContainer();
  const transcriptStore = container.get("TRANSCRIPT_STORE");

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* no body is fine */ }

  const dictation = await transcriptStore.getDictation(dictationId);
  if (!dictation) return jsonError(404, "dictation not found");

  const owns = await container.get("STORY_WORLD_STORE").checkStoryOwner(dictation.storyId, userId);
  if (!owns) return jsonError(403, "forbidden");

  const transcript =
    typeof body.transcript === "string" && body.transcript.trim()
      ? body.transcript.trim()
      : dictation.transcript;
  if (!transcript) return jsonError(409, "no transcript available");

  const sceneId = typeof body.sceneId === "string" ? body.sceneId : null;

  if (transcript !== dictation.transcript) {
    await transcriptStore.updateDictation(dictationId, {
      transcript,
      wordCount: transcript.split(/\s+/).filter(Boolean).length,
    });
  }

  const store = container.get("STORY_WORLD_STORE");
  let chapterId: string | null = null;
  let sceneTitle: string | null = null;
  let chapterTitle: string | null = null;
  if (sceneId) {
    try {
      const scene = await store.getProseScene(dictation.storyId, sceneId);
      if (scene) {
        sceneTitle = scene.title ?? null;
        chapterId = scene.chapterId ?? null;
        if (chapterId) {
          const chapters = await store.listChapters(dictation.storyId);
          chapterTitle = chapters.find((ch) => ch.id === chapterId)?.title ?? null;
        }
      }
    } catch { /* non-fatal */ }
  }

  const job: ExtractionJob = {
    dictationId,
    storyId: dictation.storyId,
    transcript,
    sceneId,
    chapterId,
    sceneTitle,
    chapterTitle,
  };

  await container.get("EXTRACTION_QUEUE").enqueue("extraction", job);
  return new NextResponse(null, { status: 202 });
}
