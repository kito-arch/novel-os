import { z } from "zod";
import { assemblyaiStt } from "@/adapters";
import { S3AudioStorage } from "@/server/audio-storage";
import { PostgresTranscriptStore } from "@/adapters/postgres";
import type { TranscriptionJob } from "@/container/job-queue";
import { ASSEMBLYAI_MAX_CONCURRENT } from "@/container/job-queue";
import { connectDb } from "./db";

// SQS event types (subset of aws-lambda — avoids a dev-dependency).
interface SQSRecord { messageId: string; body: string; }
interface SQSEvent { Records: SQSRecord[]; }
interface SQSBatchResponse { batchItemFailures: Array<{ itemIdentifier: string }>; }

// Lambda handler triggered by the transcription SQS queue.
//
// AWS configuration required:
//   - Event source: SQS_TRANSCRIPTION_QUEUE_URL
//   - Batch size: 1
//   - Reserved concurrency: ASSEMBLYAI_MAX_CONCURRENT (= 5)
//   - Visibility timeout: >= function timeout (60 s)

const config = z.object({
  DATABASE_URL:   z.string().min(1),
  STT_API_KEY:    z.string().min(1),
  S3_BUCKET:      z.string().min(1),
  WEBHOOK_SECRET: z.string().optional(),
  AWS_REGION:     z.string().default("us-east-1"),
}).parse(process.env);

// Initialised once per cold start, reused across warm invocations.
const db              = connectDb(config.DATABASE_URL);
const transcriptStore = new PostgresTranscriptStore({ db });
// Lambda execution role provides credentials — no keys needed here.
const audioStorage  = new S3AudioStorage({ bucket: config.S3_BUCKET, region: config.AWS_REGION });
const stt           = assemblyaiStt({ apiKey: config.STT_API_KEY });

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  await Promise.all(
    event.Records.map(async (record) => {
      let job: TranscriptionJob | undefined;
      try {
        const parsed = JSON.parse(record.body) as { data?: TranscriptionJob } | TranscriptionJob;
        job = "data" in parsed && parsed.data ? parsed.data : (parsed as TranscriptionJob);

        const audioBuffer = await audioStorage.loadBuffer(job.audioKey);
        const { jobId } = await stt.submitTranscription({
          audioBuffer,
          mimeType: job.mimeType,
          webhookUrl: job.webhookUrl,
          webhookAuth: config.WEBHOOK_SECRET
            ? { headerName: "x-webhook-secret", headerValue: config.WEBHOOK_SECRET }
            : undefined,
        });

        await transcriptStore.updateDictation(job.dictationId, { providerJobId: jobId });
        console.log(`[TranscriptionLambda] dictation=${job.dictationId} → AssemblyAI job=${jobId}`);
      } catch (err) {
        console.error(`[TranscriptionLambda] Failed record=${record.messageId} dictation=${job?.dictationId}:`, err);
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

export { ASSEMBLYAI_MAX_CONCURRENT };
