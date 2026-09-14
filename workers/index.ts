import { buildContainer } from "@/container";
import type { ExtractionJob } from "@/container/job-queue";
import { SqsJobQueue } from "@/adapters/sqs";

// T11.2 — SQS consumer worker for the "extraction" job type. Boots the real
// container (DATABASE_URL + SQS_QUEUE_URL + real adapters must be set in env),
// registers the extraction handler, and long-polls the queue under the
// adapter's maxConcurrency bound. Graceful shutdown on SIGTERM/SIGINT.
async function main(): Promise<void> {
  const container = buildContainer();
  const queue = container.get("JOB_QUEUE");

  queue.onJobCompleted("extraction", async (payload) => {
    const job = payload as ExtractionJob;
    try {
      const result = await container.get("TRANSCRIPT_PROCESSOR").process(job);
      console.log(`[Extraction] Completed ${job.dictationId}:`, result);
    } catch (error) {
      console.error(`[Extraction] Handler failed for ${job.dictationId}:`, error);
      throw error;
    }
  });
  queue.onJobFailed("extraction", async (payload, error) => {
    const job = payload as ExtractionJob;
    console.error(`[Extraction] Job ${job.dictationId} failed:`, error);
  });

  if (queue instanceof SqsJobQueue) queue.start();
  console.log("[Extraction Worker] Started; Ctrl+C to stop.");

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Extraction Worker] ${signal} received; shutting down...`);
    if (queue instanceof SqsJobQueue) await queue.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();