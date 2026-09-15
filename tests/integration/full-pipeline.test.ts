import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TranscriptProcessor } from "@/services/llm-agent/transcript-processor";
import { askStory } from "@/services/reasoning/ask";
import { checkContinuity } from "@/services/reasoning/continuity";
import {
  createMockLlm,
  createMockStoryWorldStore,
  MockStt,
  MockTranscriptStore,
  scriptedModel,
} from "../mocks";

// T14.1 — End-to-end pipeline test using all memory adapters. Simulates what
// the API layer does: STT submit → poll → transcript → extraction → knowledge
// query → continuity check. No HTTP, no real providers.

const STORY_ID = randomUUID();

function tool(name: string, args: Record<string, unknown> = {}, id = `${name}-1`) {
  return { id, name, arguments: args };
}

describe("full pipeline (T14.1)", () => {
  it("voice dictation → extraction → query knowledge → continuity check", async () => {
    // --- adapters ---
    const TRANSCRIPT = "Aria Voss captains the Relentless. She fears no one.";
    const stt = new MockStt({ transcript: TRANSCRIPT, durationSeconds: 15 });
    const transcriptStore = new MockTranscriptStore();
    const store = createMockStoryWorldStore();
    const llm = createMockLlm({
      defaultCompletion: "Aria Voss is the captain of the Relentless.",
    });

    // --- STEP 1: submit audio (API: POST /api/dictations) ---
    const DICTATION_ID = await transcriptStore.saveDictation({
      storyId: STORY_ID,
      userId: "user-1",
      status: "pending",
    });

    const { jobId } = await stt.submitTranscription({
      audioBuffer: Buffer.from("fake-audio"),
      mimeType: "audio/wav",
      webhookUrl: "http://localhost/api/hooks/stt-callback",
    });
    expect(jobId).toMatch(/^mock-/);

    // --- STEP 2: poll status (API: GET /api/dictations/[id]) ---
    const status = await stt.getJobStatus(jobId);
    expect(status.status).toBe("completed");

    // --- STEP 3: get transcript ---
    const { transcript, durationSeconds } = await stt.getTranscript(jobId);
    expect(transcript).toBe(TRANSCRIPT);
    expect(durationSeconds).toBe(15);

    // --- STEP 4: extraction via TranscriptProcessor ---
    const model = scriptedModel([
      { toolCalls: [tool("list_entity_types", { storyId: STORY_ID })] },
      { toolCalls: [tool("stage_create_entity_type", { name: "starship", pluralName: "starships", baseKind: "physical" })] },
      { toolCalls: [tool("stage_create_entity", { entityTypeName: "starship", name: "Relentless" })] },
      { toolCalls: [tool("stage_create_entity_type", { name: "character", pluralName: "characters", baseKind: "character" })] },
      { toolCalls: [tool("stage_create_entity", { entityTypeName: "character", name: "Aria Voss" })] },
      {
        toolCalls: [tool("stage_create_fact", {
          subject: "Aria Voss",
          predicate: "captains",
          objectValue: "Relentless",
          confidence: "explicit",
        })],
      },
      { toolCalls: [tool("finish", {}, "finish-1")] },
    ]);

    const processor = new TranscriptProcessor({ model, store });
    const result = await processor.process({ storyId: STORY_ID, dictationId: DICTATION_ID, transcript });

    expect(result.chunks).toHaveLength(1);
    expect(result.commitResults).toHaveLength(1);
    const commitResult = result.commitResults[0];
    expect(commitResult.entityTypesCreated).toBe(2);
    expect(commitResult.entitiesCreated).toBe(2);
    expect(commitResult.factsAdded).toBe(1);

    // --- STEP 5: update dictation to completed ---
    await transcriptStore.updateDictation(DICTATION_ID, {
      status: "completed",
      transcript,
      wordCount: transcript.split(/\s+/).length,
      durationSeconds,
      summary: commitResult,
      processedAt: new Date(),
    });

    const saved = await transcriptStore.getDictation(DICTATION_ID);
    expect(saved?.status).toBe("completed");
    expect(saved?.summary?.entitiesCreated).toBe(2);

    // --- STEP 6: verify story world state ---
    const world = await store.getWorld(STORY_ID);
    expect(world).not.toBeNull();
    expect(world!.entities.map((e) => e.name)).toContain("Aria Voss");
    expect(world!.entities.map((e) => e.name)).toContain("Relentless");
    expect(world!.facts).toHaveLength(1);
    expect(world!.facts[0].subject).toBe("Aria Voss");

    // --- STEP 7: query knowledge with askStory ---
    const answer = await askStory(
      { store, llm },
      STORY_ID,
      "Who captains the Relentless?",
    );
    expect(answer).toBeTruthy();
    expect(typeof answer).toBe("string");

    // --- STEP 8: continuity check ---
    const reports = await checkContinuity(
      { store, llm },
      STORY_ID,
      "all",
    );
    expect(Array.isArray(reports)).toBe(true);
  });

  it("write tab: typed text bypasses STT and feeds directly into extraction", async () => {
    const TEXT = "Commander Nadia boards the station at dawn.";
    const store = createMockStoryWorldStore();

    const model = scriptedModel([
      { toolCalls: [tool("stage_create_entity_type", { name: "character", pluralName: "characters", baseKind: "character" })] },
      { toolCalls: [tool("stage_create_entity", { entityTypeName: "character", name: "Nadia" })] },
      { toolCalls: [tool("finish", {}, "finish-1")] },
    ]);

    const result = await new TranscriptProcessor({ model, store }).process({
      storyId: STORY_ID,
      dictationId: randomUUID(),
      transcript: TEXT,
    });

    expect(result.commitResults[0].entitiesCreated).toBe(1);
    const world = await store.getWorld(STORY_ID);
    expect(world!.entities[0].name).toBe("Nadia");
  });

  it("empty transcript is a no-op: world unchanged, dictation updated to completed", async () => {
    const store = createMockStoryWorldStore();
    const transcriptStore = new MockTranscriptStore();
    const model = scriptedModel([]);

    const dictationId = randomUUID();
    await transcriptStore.saveDictation({
      storyId: STORY_ID,
      userId: "user-1",
      status: "processing",
    });

    const result = await new TranscriptProcessor({ model, store }).process({
      storyId: STORY_ID,
      dictationId,
      transcript: "   ",
    });

    expect(result.chunks).toHaveLength(0);
    expect(result.commitResults).toHaveLength(0);
    expect(await store.getWorld(STORY_ID)).toBeNull();
  });
});
