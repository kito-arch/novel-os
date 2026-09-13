import { randomUUID } from "node:crypto";
import type { Clock } from "../../container/clock";
import type { Dictation, DictationStatus, TranscriptStore } from "../../container/transcript-store";

// In-memory TranscriptStore for tests/dev. Keyed by dictation id; the
// provider-job-id lookup is a linear scan (small scale, dev only).
export interface MockTranscriptStoreOptions {
  clock?: Clock;
  now?: () => Date;
}

export class MockTranscriptStore implements TranscriptStore {
  private readonly dictations = new Map<string, Dictation>();

  constructor(private readonly options: MockTranscriptStoreOptions = {}) {}

  private now(): Date {
    return this.options.clock?.now() ?? this.options.now?.() ?? new Date();
  }

  async saveDictation(params: {
    storyId: string;
    userId: string;
    audioUrl?: string;
    providerJobId?: string;
    transcript?: string;
    wordCount?: number;
    durationSeconds?: number;
    status: DictationStatus;
  }): Promise<string> {
    const id = randomUUID();
    const row: Dictation = {
      id,
      userId: params.userId,
      storyId: params.storyId,
      providerJobId: params.providerJobId ?? null,
      audioUrl: params.audioUrl ?? null,
      transcript: params.transcript ?? null,
      wordCount: params.wordCount ?? null,
      durationSeconds: params.durationSeconds ?? null,
      status: params.status,
      createdAt: this.now(),
      processedAt: null,
    };
    this.dictations.set(id, row);
    return id;
  }

  async getDictation(dictationId: string): Promise<Dictation | null> {
    return this.dictations.get(dictationId) ?? null;
  }

  async findDictationByProviderJobId(providerJobId: string): Promise<{
    id: string;
    storyId: string;
    userId: string;
    status: DictationStatus;
  } | null> {
    for (const row of this.dictations.values()) {
      if (row.providerJobId === providerJobId) {
        return { id: row.id, storyId: row.storyId, userId: row.userId, status: row.status };
      }
    }
    return null;
  }

  async updateDictation(
    dictationId: string,
    updates: {
      providerJobId?: string;
      transcript?: string;
      wordCount?: number;
      durationSeconds?: number;
      status?: DictationStatus;
      processedAt?: Date;
    },
  ): Promise<void> {
    const row = this.dictations.get(dictationId);
    if (!row) throw new Error(`dictation "${dictationId}" not found`);
    this.dictations.set(dictationId, {
      ...row,
      ...updates,
      providerJobId: updates.providerJobId ?? row.providerJobId,
      transcript: updates.transcript ?? row.transcript,
      wordCount: updates.wordCount ?? row.wordCount,
      durationSeconds: updates.durationSeconds ?? row.durationSeconds,
      status: updates.status ?? row.status,
      processedAt: updates.processedAt ?? row.processedAt,
    });
  }

  async listDictations(params: { storyId: string; userId?: string }): Promise<Dictation[]> {
    const rows = [...this.dictations.values()];
    return rows
      .filter((row) => row.storyId === params.storyId)
      .filter((row) => (params.userId ? row.userId === params.userId : true));
  }
}

export function createMockTranscriptStore(
  options: MockTranscriptStoreOptions = {},
): TranscriptStore {
  return new MockTranscriptStore(options);
}

export const mockTranscriptStore = new MockTranscriptStore();