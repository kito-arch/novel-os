import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

// T12.2 — Dictation status. Returns the job status plus the aggregate
// CommitResult summary once processing completes (workers write it on the row).
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const dictation = await resolveContainer().get("TRANSCRIPT_STORE").getDictation(id);
  if (!dictation) return jsonError(404, "dictation not found");

  return NextResponse.json({
    id: dictation.id,
    storyId: dictation.storyId,
    status: dictation.status,
    transcript: dictation.transcript,
    wordCount: dictation.wordCount,
    durationSeconds: dictation.durationSeconds,
    summary: dictation.summary,
    processedAt: dictation.processedAt,
  });
}