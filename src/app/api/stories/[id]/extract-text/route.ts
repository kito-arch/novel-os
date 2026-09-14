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

  const { text } = body as { text?: string };
  if (!text || typeof text !== "string" || !text.trim()) {
    return jsonError(400, "text is required");
  }
  const transcript = text.trim();

  const container = resolveContainer();
  const transcriptStore = container.get("TRANSCRIPT_STORE");
  const processor = container.get("TRANSCRIPT_PROCESSOR");

  const dictationId = await transcriptStore.saveDictation({
    storyId,
    userId: userId ?? "anonymous",
    transcript,
    wordCount: transcript.split(/\s+/).filter(Boolean).length,
    status: "processing",
  });

  const job: ExtractionJob = { dictationId, storyId, transcript };

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
