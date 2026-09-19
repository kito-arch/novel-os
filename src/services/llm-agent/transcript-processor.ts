import { generateText, hasToolCall, stepCountIs, type LanguageModel } from "ai";
import type { ExtractionJob } from "@/container/job-queue";
import type { StoryWorldStore } from "@/container/story-world-store";
import type { CommitResult } from "@/domain/commits";
import type { StoryWorld } from "@/domain/story-world";
import { CommitBuilder } from "./tools/build-commit";
import { buildStoryTools } from "./tools/sdk";
import { TOOL_FINISH, MAX_FETCHES, MAX_TOOL_CALLS } from "./tools/definitions";
import { Session } from "./tools/session";

export interface ExtractionDeps {
  model: LanguageModel;
  store: StoryWorldStore;
}

// ~4k tokens of prose ≈ 16k chars; chunk boundaries are sentence-aware.
export const CHUNK_CHARS = 16_000;

export interface ChunkTrace {
  chunkIndex: number;
  textChunk: string;
  toolCalls: number;
  fetches: number;
  stoppedReason: string | null;
  commitResult: CommitResult | null;
}

export interface ProcessTranscriptResult {
  commitResults: CommitResult[];
  chunks: ChunkTrace[];
}

// Folds a job's per-chunk CommitResults into a single aggregate summary. All
// counters sum across chunks; revision reflects the final applied revision.
export function aggregateCommitResults(results: CommitResult[]): CommitResult | null {
  if (results.length === 0) return null;
  const entitiesCreatedByType: Record<string, number> = {};
  for (const result of results) {
    for (const [type, count] of Object.entries(result.entitiesCreatedByType)) {
      entitiesCreatedByType[type] = (entitiesCreatedByType[type] ?? 0) + count;
    }
  }
  const last = results[results.length - 1];
  return {
    revision: last.revision,
    entityTypesCreated: results.reduce((sum, r) => sum + r.entityTypesCreated, 0),
    entitiesCreated: results.reduce((sum, r) => sum + r.entitiesCreated, 0),
    entitiesUpdated: results.reduce((sum, r) => sum + r.entitiesUpdated, 0),
    entitiesCreatedByType,
    eventsAdded: results.reduce((sum, r) => sum + r.eventsAdded, 0),
    factsAdded: results.reduce((sum, r) => sum + r.factsAdded, 0),
    relationshipsAdded: results.reduce((sum, r) => sum + r.relationshipsAdded, 0),
    knowledgeAdded: results.reduce((sum, r) => sum + r.knowledgeAdded, 0),
    scenesAdded: results.reduce((sum, r) => sum + r.scenesAdded, 0),
    plotThreadsUpdated: results.reduce((sum, r) => sum + r.plotThreadsUpdated, 0),
    openQuestionsAdded: results.reduce((sum, r) => sum + r.openQuestionsAdded, 0),
    openQuestionsResolved: results.reduce((sum, r) => sum + r.openQuestionsResolved, 0),
    contradictionsFound: results.reduce((sum, r) => sum + r.contradictionsFound, 0),
    factsSuperseded: results.reduce((sum, r) => sum + r.factsSuperseded, 0),
  };
}

// T5.4 — the extraction agent. Dependencies are injected via the constructor
// (the container binds this as TRANSCRIPT_PROCESSOR, resolving the AI SDK
// model and story store), so process() only takes the job. Loads the story,
// chunks the transcript, drives the bounded generateText tool loop per chunk
// (budget stop conditions T5.2/T5.4), and commits each chunk's staging through
// the same applyCommit gate the Postgres adapter will enforce. Empty transcript
// (or a chunk that stages nothing) is a no-op and yields no commit.
export class TranscriptProcessor {
  private readonly deps: ExtractionDeps;

  constructor(deps: ExtractionDeps) {
    this.deps = deps;
  }

  // Split a transcript into sentence-ish chunks of roughly `chunkChars` chars.
  // A chunk is never split mid-sentence when a break exists within the window.
  private chunkText(text: string, chunkChars = CHUNK_CHARS): string[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) return [];
    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < trimmed.length) {
      if (trimmed.length - cursor <= chunkChars) {
        chunks.push(trimmed.slice(cursor).trim());
        break;
      }
      const window = trimmed.slice(cursor, cursor + chunkChars);
      const lastSentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf("\n\n"),
      );
      const cut = lastSentence > chunkChars / 2 ? lastSentence + 1 : chunkChars;
      chunks.push(trimmed.slice(cursor, cursor + cut).trim());
      cursor += cut;
    }
    return chunks.filter((chunk) => chunk.length > 0);
  }

  async process(job: ExtractionJob): Promise<ProcessTranscriptResult> {
    const chunks = this.chunkText(job.transcript);
    const world = await this.deps.store.getWorld(job.storyId);
    const traces: ChunkTrace[] = [];
    let latestWorld = world;

    for (const [index, chunk] of chunks.entries()) {
      const trace = await this.runChunk(job, index, chunk, latestWorld);
      traces.push(trace);
      if (trace.commitResult) {
        latestWorld = await this.deps.store.getWorld(job.storyId);
      }
    }

    return {
      chunks: traces,
      commitResults: traces.flatMap((trace) => (trace.commitResult ? [trace.commitResult] : [])),
    };
  }

  private buildSystemPrompt(world: StoryWorld | null, job?: ExtractionJob): string {
    const typeCount = world?.entityTypes.length ?? 0;
    const entityCount = world?.entities.length ?? 0;

    const openQuestions = (world?.openQuestions ?? [])
      .filter((q) => !q.isResolved)
      .slice(0, 10)
      .map((q) => `  - ${q.question}`)
      .join("\n");

    return [
      `You are the story extraction agent for the world "${world?.title ?? "Untitled story"}" (${typeCount} entity types, ${entityCount} entities).`,
      "",
      "The user message is a chapter transcript chunk. Extract the story knowledge it adds.",
      "",
      "RULES",
      "- Call list_entity_types first to see the full type registry before staging entities or events.",
      "- Use get_entities to look up existing entities of a type before creating new ones (check for alias conflicts).",
      "- Use list_facts(query) to check or retrieve existing facts; it also returns fact ids for supersede_fact.",
      "- Staged writes (stage_*) do NOT persist until you call finish(). You may create types, then entities of those types, in the same session.",
      "- Every entity, event, fact, and relationship you stage must trace to the transcript.",
      "- Use confident wording only where the text is explicit; otherwise use implied/inferred.",
      "- Never fictionalize; if the text is silent, do not invent.",
      "- ENTITY QUALITY: Only create entities for named, recurring, story-significant people, places, or objects. Do NOT create entities for incidental props or background details (a branch, a door, a sound, a bush, a moonlit sky). If something is mentioned once in passing and has no story significance beyond that moment, skip it.",
      "- ALIAS CONFLICTS: Before creating a new entity, call get_entities to check if an existing entity's name or aliases already match. If so, use stage_update_entity instead of creating a duplicate.",
      "- DIALOGUE: When the transcript contains direct speech without quotation marks (e.g. \"Richard said let's play together\"), treat it as direct dialogue and use proper double quotes in any fact, event, or knowledge you stage (e.g. Richard said \"let's play together\").",
      "",
      `BUDGET: at most ${MAX_TOOL_CALLS} tool calls and ${MAX_FETCHES} entity fetches per chunk. get_entities clamps each call to ${Math.min(200, MAX_FETCHES)} rows.`,
      "",
      "OPEN QUESTIONS (resolve any answered here via stage_resolve_open_question)",
      openQuestions || "  (none)",
      ...(job?.sceneId
        ? [
            "",
            "CURRENT NARRATION CONTEXT",
            `- Scene: "${job.sceneTitle ?? "Untitled scene"}" (sceneId: ${job.sceneId})` +
              (job.chapterTitle ? ` — Chapter: "${job.chapterTitle}"` : ""),
            "- When staging events with stage_create_event, set sceneId to the value above unless the event clearly belongs to a different scene.",
          ]
        : []),
      "",
      "To finish, call finish() only after staging at least one change. Nothing persists until then.",
    ].join("\n");
  }

  // Processes one chunk through the AI SDK tool loop (generateText with
  // stopWhen covering the T5.2/T5.4 budgets) and commits whatever was staged
  // when the loop ends (finish call, model stopped offering tools, or budget).
  private async runChunk(
    job: ExtractionJob,
    chunkIndex: number,
    textChunk: string,
    world: StoryWorld | null,
  ): Promise<ChunkTrace> {
    const session = Session.create(job.storyId);
    const tools = buildStoryTools({ store: this.deps.store, session });

    const { steps } = await generateText({
      model: this.deps.model,
      system: this.buildSystemPrompt(world, job),
      prompt: textChunk,
      tools,
      temperature: 0,
      // Budget stop conditions mirror the old hand-rolled loop: finish ends the
      // chunk, stepCountIs is a hard ceiling, and the counter-based conditions
      // end the run the moment a step pushes past the T5.2 limits.
      stopWhen: [
        stepCountIs(MAX_TOOL_CALLS),
        hasToolCall(TOOL_FINISH),
        () => session.counters.fetchedEntities >= MAX_FETCHES,
        () => session.counters.toolCalls >= MAX_TOOL_CALLS,
      ],
    });

    const lastStep = steps[steps.length - 1];
    const lastOffered = lastStep?.toolCalls ?? [];
    let stoppedReason: string | null;
    if (lastOffered.some((call) => call.toolName === TOOL_FINISH)) {
      stoppedReason = "finished";
    } else if (session.counters.toolCalls >= MAX_TOOL_CALLS) {
      stoppedReason = "tool-call-limit";
    } else if (session.counters.fetchedEntities >= MAX_FETCHES) {
      stoppedReason = "fetch-limit";
    } else {
      stoppedReason = "no-tool-calls";
    }

    const commitResult = Session.hasStagedChanges(session)
      ? await CommitBuilder.buildFromStaged(this.deps.store, session, {
          dictationId: job.dictationId,
          textChunk,
          sceneId: job.sceneId ?? null,
        })
      : null;

    return {
      chunkIndex,
      textChunk,
      toolCalls: session.counters.toolCalls,
      fetches: session.counters.fetchedEntities,
      stoppedReason,
      commitResult,
    };
  }
}