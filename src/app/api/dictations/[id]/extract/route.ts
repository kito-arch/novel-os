import { NextResponse, type NextRequest } from "next/server";
import type { CommitResult } from "@/domain/commits";
import type { ExtractionJob } from "@/container/job-queue";
import { resolveContainer } from "@/server/app-container";
import { jsonError, userIdFrom } from "@/server/http";

function summarizeCommit(r: CommitResult): string {
  const parts: string[] = [];
  if (r.entitiesCreated) parts.push(`${r.entitiesCreated} entit${r.entitiesCreated === 1 ? "y" : "ies"} created`);
  if (r.entitiesUpdated) parts.push(`${r.entitiesUpdated} updated`);
  if (r.factsAdded) parts.push(`${r.factsAdded} fact${r.factsAdded === 1 ? "" : "s"} added`);
  if (r.eventsAdded) parts.push(`${r.eventsAdded} event${r.eventsAdded === 1 ? "" : "s"} added`);
  if (r.relationshipsAdded) parts.push(`${r.relationshipsAdded} relationship${r.relationshipsAdded === 1 ? "" : "s"} added`);
  if (r.plotThreadsUpdated) parts.push(`${r.plotThreadsUpdated} plot thread${r.plotThreadsUpdated === 1 ? "" : "s"} updated`);
  if (r.openQuestionsAdded) parts.push(`${r.openQuestionsAdded} open question${r.openQuestionsAdded === 1 ? "" : "s"} added`);
  if (r.openQuestionsResolved) parts.push(`${r.openQuestionsResolved} resolved`);
  if (r.contradictionsFound) parts.push(`${r.contradictionsFound} contradiction${r.contradictionsFound === 1 ? "" : "s"} found`);
  return parts.length ? parts.join(" · ") : "No changes";
}

// User-triggered extraction for an audio dictation that has been transcribed.
// The client may submit an edited transcript; if omitted the stored transcript
// is used. Runs the same LLM extraction pipeline as extract-text but scoped to
// an existing dictation row rather than creating a new one.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = userIdFrom(request);
  if (!userId) return jsonError(401, "missing x-user-id header");

  const { id: dictationId } = await ctx.params;
  const container = resolveContainer();
  const transcriptStore = container.get("TRANSCRIPT_STORE");

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* no body is fine */ }

  const dictation = await transcriptStore.getDictation(dictationId);
  if (!dictation) return jsonError(404, "dictation not found");

  const transcript =
    typeof body.transcript === "string" && body.transcript.trim()
      ? body.transcript.trim()
      : dictation.transcript;
  if (!transcript) return jsonError(409, "no transcript available");

  const sceneId = typeof body.sceneId === "string" ? body.sceneId : null;

  // Persist any user edits to the transcript before running extraction.
  if (transcript !== dictation.transcript) {
    await transcriptStore.updateDictation(dictationId, {
      transcript,
      wordCount: transcript.split(/\s+/).filter(Boolean).length,
    });
  }

  const store = container.get("STORY_WORLD_STORE");
  const processor = container.get("TRANSCRIPT_PROCESSOR");

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

  try {
    const result = await processor.process(job);
    const commitResult = result.commitResults[result.commitResults.length - 1] ?? null;
    await transcriptStore.updateDictation(dictationId, {
      status: "completed",
      summary: commitResult,
      processedAt: new Date(),
    });
    return NextResponse.json({
      summary: commitResult ? summarizeCommit(commitResult) : "No changes",
    });
  } catch (err) {
    await transcriptStore.updateDictation(dictationId, {
      status: "failed",
      processedAt: new Date(),
    });
    return jsonError(500, (err as Error).message);
  }
}
