import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Clock } from "@/container/clock";
import type { Dictation, TranscriptStore } from "@/container/transcript-store";
import * as schema from "../../../drizzle/schema";
import { dictations, stories } from "../../../drizzle/schema";

export interface PostgresTranscriptStoreOptions {
  db: PostgresJsDatabase<typeof schema>;
  clock?: Clock;
}

const DEFAULT_TITLE = "Untitled story";
const SYSTEM_OWNER = "system";

// Postgres-backed TranscriptStore for dictations (raw audio + transcript rows).
export class PostgresTranscriptStore implements TranscriptStore {
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor(private readonly options: PostgresTranscriptStoreOptions) {
    this.db = options.db;
  }

  private now(): Date {
    return this.options.clock?.now() ?? new Date();
  }

  async saveDictation(params: {
    storyId: string;
    userId: string;
    audioUrl?: string;
    providerJobId?: string;
    transcript?: string;
    wordCount?: number;
    durationSeconds?: number;
    status: Dictation["status"];
  }): Promise<string> {
    // dictations.story_id FKs to stories; the store creates the story shell
    // (like PostgresStoryWorldStore) so transcript capture can precede any
    // world-building commit.
    await this.db
      .insert(stories)
      .values({
        id: params.storyId,
        title: DEFAULT_TITLE,
        ownerId: SYSTEM_OWNER,
        updatedAt: this.now(),
      })
      .onConflictDoNothing();
    const id = randomUUID();
    await this.db.insert(dictations).values({
      id,
      storyId: params.storyId,
      userId: params.userId,
      audioUrl: params.audioUrl ?? null,
      providerJobId: params.providerJobId ?? null,
      transcript: params.transcript ?? null,
      wordCount: params.wordCount ?? null,
      durationSeconds: params.durationSeconds ?? null,
      status: params.status,
      processedAt: null,
      createdAt: this.now(),
    });
    return id;
  }

  async getDictation(dictationId: string): Promise<Dictation | null> {
    const rows = await this.db
      .select()
      .from(dictations)
      .where(eq(dictations.id, dictationId))
      .limit(1);
    return rows[0] ? dictationFromRow(rows[0]) : null;
  }

  async findDictationByProviderJobId(providerJobId: string): Promise<{
    id: string;
    storyId: string;
    userId: string;
    status: Dictation["status"];
  } | null> {
    const rows = await this.db
      .select()
      .from(dictations)
      .where(eq(dictations.providerJobId, providerJobId))
      .limit(1);
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      storyId: rows[0].storyId,
      userId: rows[0].userId,
      status: rows[0].status,
    };
  }

  async updateDictation(
    dictationId: string,
    updates: {
      providerJobId?: string;
      transcript?: string;
      wordCount?: number;
      durationSeconds?: number;
      status?: Dictation["status"];
      processedAt?: Date;
    },
  ): Promise<void> {
    const result = await this.db
      .update(dictations)
      .set({ ...updates })
      .where(eq(dictations.id, dictationId))
      .returning({ id: dictations.id });
    if (result.length === 0) {
      throw new Error(`dictation "${dictationId}" not found`);
    }
  }

  async listDictations(params: { storyId: string; userId?: string }): Promise<Dictation[]> {
    const where = params.userId
      ? and(eq(dictations.storyId, params.storyId), eq(dictations.userId, params.userId))
      : eq(dictations.storyId, params.storyId);
    const rows = await this.db
      .select()
      .from(dictations)
      .where(where)
      .orderBy(asc(dictations.createdAt));
    return rows.map(dictationFromRow);
  }
}

function dictationFromRow(row: typeof dictations.$inferSelect): Dictation {
  return {
    id: row.id,
    userId: row.userId,
    storyId: row.storyId,
    providerJobId: row.providerJobId ?? null,
    audioUrl: row.audioUrl ?? null,
    transcript: row.transcript ?? null,
    wordCount: row.wordCount ?? null,
    durationSeconds: row.durationSeconds ?? null,
    status: row.status,
    createdAt: row.createdAt,
    processedAt: row.processedAt ?? null,
  };
}