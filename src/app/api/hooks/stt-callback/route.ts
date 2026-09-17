import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

// T12.10 — AssemblyAI webhook. The callback is authenticated by a shared
// header secret (AssemblyAI webhook_auth_header_name/value echo), never by URL
// params or the body. Identity is resolved by transcript_id → dictation row;
// the stored row's userId/storyId are the authority. On completion the
// transcript is fetched and the extraction job is enqueued.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = resolveContainer();
  const config = container.get("CONFIG");
  const secret = config.WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-webhook-secret") !== secret) {
    return jsonError(401, "missing or invalid webhook secret");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const transcriptId = (body as { transcript_id?: unknown } | null)?.transcript_id;
  if (typeof transcriptId !== "string" || transcriptId.trim() === "") {
    return jsonError(400, "transcript_id required");
  }

  const transcriptStore = container.get("TRANSCRIPT_STORE");
  const dictation = await transcriptStore.findDictationByProviderJobId(transcriptId);
  if (!dictation) return jsonError(404, "unknown transcript_id");

  const callbackStatus = (body as { status?: unknown } | null)?.status;
  if (callbackStatus === "error" || callbackStatus === "failed") {
    await transcriptStore.updateDictation(dictation.id, {
      status: "failed",
      processedAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  }

  const result = await container.get("STT").getTranscript(transcriptId);
  const wordCount = countWords(result.transcript);
  // Save transcript but leave status as "processing" — the user reviews and
  // edits the transcript in the widget before triggering LLM extraction via
  // POST /api/dictations/[id]/extract.
  await transcriptStore.updateDictation(dictation.id, {
    status: "processing",
    transcript: result.transcript,
    wordCount,
    durationSeconds: result.durationSeconds ?? undefined,
  });

  return NextResponse.json({ ok: true });
}

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}