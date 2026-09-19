import { NextResponse, type NextRequest } from "next/server";
import type { TranscriptionJob } from "@/container/job-queue";
import { resolveContainer } from "@/server/app-container";
import { requireAuth } from "@/server/auth";
import { jsonError } from "@/server/http";

// Dictation upload. multipart/form-data: `audio` file + `storyId`.
// The audio is stored via AUDIO_STORAGE (S3 in prod, local disk in dev) and a
// "transcription" job is enqueued so the worker submits it to AssemblyAI within
// the ASSEMBLYAI_MAX_CONCURRENT concurrency cap. The HTTP response returns
// immediately — transcription is fully async; clients subscribe to
// GET /api/dictations/[id]/stream for status updates.
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
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "audio/webm";

  const { url: audioUrl, key: audioKey } = await container
    .get("AUDIO_STORAGE")
    .save(buffer, mimeType, { userId, storyId });

  const transcriptStore = container.get("TRANSCRIPT_STORE");
  const dictationId = await transcriptStore.saveDictation({
    storyId,
    userId,
    status: "pending",
    audioUrl,
  });

  const webhookUrl = `${request.nextUrl.origin}/api/hooks/stt-callback`;
  const job: TranscriptionJob = { dictationId, audioKey, mimeType, webhookUrl };
  await container.get("TRANSCRIPTION_QUEUE").enqueue("transcription", job);

  return NextResponse.json({ dictationId });
}
