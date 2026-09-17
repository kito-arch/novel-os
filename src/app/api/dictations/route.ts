import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { requireAuth } from "@/server/auth";
import { jsonError } from "@/server/http";

// T12.1 — Dictation upload. multipart/form-data: `audio` file + `storyId`.
// The owning user comes from the session header (never the form/webhook).
// The webhook URL is assembled with NO query params; the AssemblyAI
// transcript_id returned by submitTranscription is persisted as providerJobId
// so the callback (T12.10) can correlate the dictation by transcript_id only.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const form = await request.formData();
  const file = form.get("audio");
  const storyId = form.get("storyId");
  if (!(file instanceof File)) return jsonError(400, "audio file required (field name: audio)");
  if (typeof storyId !== "string" || storyId.trim() === "") {
    return jsonError(400, "storyId required");
  }

  const container = resolveContainer();
  const config = container.get("CONFIG");
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const webhookUrl = `${request.nextUrl.origin}/api/hooks/stt-callback`;

  const transcriptStore = container.get("TRANSCRIPT_STORE");
  const dictationId = await transcriptStore.saveDictation({
    storyId,
    userId,
    status: "pending",
    audioUrl: file.name || undefined,
  });

  const { jobId } = await container.get("STT").submitTranscription({
    audioBuffer: buffer,
    mimeType,
    webhookUrl,
    webhookAuth: config.WEBHOOK_SECRET
      ? { headerName: "x-webhook-secret", headerValue: config.WEBHOOK_SECRET }
      : undefined,
  });
  await transcriptStore.updateDictation(dictationId, { providerJobId: jobId });

  return NextResponse.json({ dictationId, jobId });
}