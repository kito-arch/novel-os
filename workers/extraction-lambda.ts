import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { PostgresStoryWorldStore, PostgresTranscriptStore } from "@/adapters/postgres";
import { TranscriptProcessor, aggregateCommitResults } from "@/services/llm-agent/transcript-processor";
import type { ExtractionJob } from "@/container/job-queue";
import { connectDb } from "./db";

// SQS event types (subset of aws-lambda — avoids a dev-dependency).
interface SQSRecord { messageId: string; body: string; }
interface SQSEvent { Records: SQSRecord[]; }
interface SQSBatchResponse { batchItemFailures: Array<{ itemIdentifier: string }>; }

// Lambda handler triggered by the extraction SQS queue.
//
// AWS configuration required:
//   - Event source: SQS_EXTRACTION_QUEUE_URL
//   - Batch size: 1
//   - Reserved concurrency: tune to LLM provider rate limit (default 5)
//   - Visibility timeout: >= function timeout (120 s)

const config = z.object({
  DATABASE_URL:       z.string().min(1),
  LLM_PROVIDER:       z.enum(["openai", "anthropic"]),
  LLM_API_KEY:        z.string().min(1),
  LLM_STANDARD_MODEL: z.string().default("gpt-4o"),
}).parse(process.env);

// Initialised once per cold start, reused across warm invocations.
const db              = connectDb(config.DATABASE_URL);
const storyWorldStore = new PostgresStoryWorldStore({ db });
const transcriptStore = new PostgresTranscriptStore({ db });

const model = config.LLM_PROVIDER === "anthropic"
  ? createAnthropic({ apiKey: config.LLM_API_KEY }).languageModel(config.LLM_STANDARD_MODEL)
  : createOpenAI({ apiKey: config.LLM_API_KEY }).languageModel(config.LLM_STANDARD_MODEL);

const processor = new TranscriptProcessor({ model, store: storyWorldStore });

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  await Promise.all(
    event.Records.map(async (record) => {
      let job: ExtractionJob | undefined;
      try {
        const parsed = JSON.parse(record.body) as { data?: ExtractionJob } | ExtractionJob;
        job = "data" in parsed && parsed.data ? parsed.data : (parsed as ExtractionJob);

        const result = await processor.process(job);
        const summary = aggregateCommitResults(result.commitResults);

        await transcriptStore.updateDictation(job.dictationId, {
          status: "completed",
          summary,
          processedAt: new Date(),
        });

        console.log(`[ExtractionLambda] dictation=${job.dictationId} completed`);
      } catch (err) {
        console.error(`[ExtractionLambda] Failed record=${record.messageId} dictation=${job?.dictationId}:`, err);
        if (job?.dictationId) {
          await transcriptStore.updateDictation(job.dictationId, {
            status: "failed",
            processedAt: new Date(),
          }).catch(() => {});
        }
        failures.push(record.messageId);
      }
    }),
  );

  return { batchItemFailures: failures.map((id) => ({ itemIdentifier: id })) };
};
