import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { CommitResult } from "@/domain/commits";
import { resolveContainer } from "@/server/app-container";
import { requireAuth } from "@/server/auth";

const POLL_MS = 2_000;
const TIMEOUT_MS = 5 * 60 * 1_000;

function sseChunk(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

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

// SSE stream for a single dictation. Polls the DB every 2 s and resolves
// pending status against AssemblyAI directly — this handles dev environments
// where the webhook URL is localhost and AssemblyAI can't reach it.
//
// Terminal events (client must close the EventSource after receiving one):
//   { status: "processing", transcript: string }   — transcript ready for review
//   { status: "completed", transcript, wordCount, summary }  — fully done
//   { status: "failed" }
//   { error: string }                              — timeout or unexpected error
//
// Non-terminal:
//   { status: "pending" }
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { id: dictationId } = await ctx.params;
  const container = resolveContainer();
  const transcriptStore = container.get("TRANSCRIPT_STORE");

  const initial = await transcriptStore.getDictation(dictationId);
  if (!initial) return NextResponse.json({ error: "not found" }, { status: 404 });

  const owns = await container.get("STORY_WORLD_STORE").checkStoryOwner(initial.storyId, userId);
  if (!owns) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const deadline = Date.now() + TIMEOUT_MS;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (data: Record<string, unknown>): void => {
        try { controller.enqueue(sseChunk(data)); } catch { /* stream already closed */ }
      };

      // Returns true when a terminal event has been emitted.
      const checkAndEmit = async (): Promise<boolean> => {
        const row = await transcriptStore.getDictation(dictationId);
        if (!row) return true;

        // "processing" is non-terminal: transcript is ready for user review but
        // extraction hasn't run yet. Keep the stream open so the "completed"
        // event arrives after the extraction worker finishes.
        if (row.status === "processing" && row.transcript) {
          enqueue({ status: "processing", transcript: row.transcript });
          return false;
        }

        if (row.status === "completed") {
          enqueue({
            status: "completed",
            transcript: row.transcript,
            wordCount: row.wordCount,
            summary: row.summary ? summarizeCommit(row.summary) : null,
          });
          return true;
        }

        if (row.status === "failed") {
          enqueue({ status: "failed" });
          return true;
        }

        // Still pending — poll AssemblyAI directly. Handles dev where the
        // webhook endpoint is localhost and AssemblyAI cannot POST to it.
        if (row.providerJobId) {
          try {
            const stt = container.get("STT");
            const job = await stt.getJobStatus(row.providerJobId);

            if (job.status === "completed") {
              const result = await stt.getTranscript(row.providerJobId);
              await transcriptStore.updateDictation(dictationId, {
                status: "processing",
                transcript: result.transcript,
                wordCount: countWords(result.transcript),
                durationSeconds: result.durationSeconds ?? undefined,
              });
              // Non-terminal: transcript ready, keep stream open for extraction.
              enqueue({ status: "processing", transcript: result.transcript });
              return false;
            }

            if (job.status === "failed") {
              await transcriptStore.updateDictation(dictationId, {
                status: "failed",
                processedAt: new Date(),
              });
              enqueue({ status: "failed" });
              return true;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Surface config errors immediately — silent timeout is worse than a clear message.
            if (message.includes("NotImplemented") || message.includes("STT_PROVIDER")) {
              enqueue({ error: "STT not configured — set STT_PROVIDER=assemblyai and STT_API_KEY in .env to enable the local dev fallback" });
              controller.close();
              return true;
            }
            // Transient network error — non-fatal, keep polling DB
          }
        }

        enqueue({ status: "pending" });
        return false;
      };

      if (await checkAndEmit()) { controller.close(); return; }

      while (!request.signal.aborted && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, POLL_MS);
          request.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
        if (request.signal.aborted) break;
        if (await checkAndEmit()) { controller.close(); return; }
      }

      if (Date.now() >= deadline) enqueue({ error: "timeout" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
