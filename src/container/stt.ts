export type TranscriptionStatus = "queued" | "processing" | "completed" | "failed";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface WebhookAuth {
  headerName: string;
  headerValue: string;
}

export interface TranscribeRequest {
  audioBuffer: Buffer;
  mimeType: string;
  webhookUrl?: string;
  // Echoed by the provider when the job completes so the callback can be
  // authenticated (AssemblyAI webhook_auth_header_name/webhook_auth_header_value).
  webhookAuth?: WebhookAuth;
}

export interface TranscriptResult {
  transcript: string;
  segments?: TranscriptSegment[];
  durationSeconds?: number;
}

export interface SpeechToText {
  // Submit audio for transcription. Returns the provider job id (AssemblyAI
  // transcript_id) which is persisted as providerJobId for callback correlation.
  submitTranscription(request: TranscribeRequest): Promise<{ jobId: string }>;

  getJobStatus(jobId: string): Promise<{
    status: TranscriptionStatus;
    transcript?: string;
    error?: string;
  }>;

  // Fetch the full transcript result by provider job id.
  getTranscript(jobId: string): Promise<TranscriptResult>;
}