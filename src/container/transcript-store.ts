import type { CommitResult } from "../domain/commits";

export type DictationStatus = "pending" | "processing" | "completed" | "failed";

export interface Dictation {
  id: string;
  userId: string;
  storyId: string;
  providerJobId: string | null;
  audioUrl: string | null;
  transcript: string | null;
  wordCount: number | null;
  durationSeconds: number | null;
  status: DictationStatus;
  summary: CommitResult | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface TranscriptStore {
  saveDictation(params: {
    storyId: string;
    userId: string; // owning user (multi-tenant)
    audioUrl?: string;
    providerJobId?: string; // AssemblyAI transcript_id
    transcript?: string;
    wordCount?: number;
    durationSeconds?: number;
    status: DictationStatus;
    summary?: CommitResult | null;
  }): Promise<string>;

  getDictation(dictationId: string): Promise<Dictation | null>;

  // Callback correlation: the only identifier the STT webhook carries is the
  // provider job id. Resolve it here so the handler learns userId/storyId from
  // the DB row — never from the webhook URL or body.
  findDictationByProviderJobId(providerJobId: string): Promise<{
    id: string;
    storyId: string;
    userId: string;
    status: DictationStatus;
  } | null>;

  updateDictation(
    dictationId: string,
    updates: {
      providerJobId?: string;
      transcript?: string;
      wordCount?: number;
      durationSeconds?: number;
      status?: DictationStatus;
      summary?: CommitResult | null;
      processedAt?: Date;
    },
  ): Promise<void>;

  listDictations(params: { storyId: string; userId?: string }): Promise<Dictation[]>;
}