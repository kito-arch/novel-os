import { NextResponse, type NextRequest } from "next/server";
import type { CommitResult } from "@/domain/commits";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

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
    summary: dictation.summary ? summarizeCommit(dictation.summary) : null,
    processedAt: dictation.processedAt,
  });
}