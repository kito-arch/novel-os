import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AppRegistry } from "@/container";
import type { TypedContainer } from "@evyweb/ioctopus";
import type { Fact } from "@/domain/provenance";
import type { ContinuityReport } from "@/services/reasoning/continuity";
import { MockJobQueue, MockLlm, createMockStt } from "../mocks";
import { setTestContainer, resetTestContainer } from "@/server/app-container";
import { POST as ask } from "@/app/api/stories/[id]/ask/route";
import { POST as analyze } from "@/app/api/stories/[id]/analyze/route";
import { POST as knowledge } from "@/app/api/stories/[id]/knowledge/route";
import { POST as sttCallback } from "@/app/api/hooks/stt-callback/route";
import { setup, TEST_USER_ID, type FixtureWorld } from "./fixtures";

function routerCtx<P extends Record<string, string>>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

async function jsonRequest(url: string, body: unknown, userId = TEST_USER_ID): Promise<NextRequest> {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify(body),
  });
}

function contradictionFacts(): { superseded: Fact; replacement: Fact } {
  const replacementId = randomUUID();
  const provenance = { dictationId: randomUUID(), textChunk: "fixture", confidence: "explicit" as const };
  return {
    superseded: {
      id: randomUUID(),
      subject: "Sarah",
      predicate: "eye color",
      objectValue: "blue",
      confidence: "explicit",
      provenance,
      supersededBy: replacementId,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    replacement: {
      id: replacementId,
      subject: "Sarah",
      predicate: "eye color",
      objectValue: "green",
      confidence: "explicit",
      provenance,
      supersededBy: null,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    },
  };
}

describe("POST /api/stories/[id]/ask (T12.5)", () => {
  let fixture: FixtureWorld;
  beforeEach(async () => {
    const llm = new MockLlm({
      completions: { "Who commands the Relentless": "Sarah commands the Relentless." },
    });
    fixture = await setup({ llm });
    setTestContainer(fixture.container);
  });
  afterEach(() => resetTestContainer());

  it("answers a question from the reasoning layer", async () => {
    const response = await ask(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/ask`,
        { question: "Who commands the Relentless?" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).answer).toContain("Sarah commands the Relentless");
  });

  it("400s an empty question", async () => {
    const response = await ask(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/ask`,
        { question: "" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(400);
  });

  it("403s a story not owned by the user", async () => {
    const response = await ask(
      await jsonRequest("https://example.com/api/stories/unknown/ask", { question: "Hi" }),
      routerCtx({ id: "unknown" }),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/stories/[id]/analyze (T12.6)", () => {
  let fixture: FixtureWorld;
  let container: TypedContainer<AppRegistry>;
  beforeEach(async () => {
    fixture = await setup();
    container = fixture.container;
    setTestContainer(container);
  });
  afterEach(() => resetTestContainer());

  it("returns contradiction reports for a superseded fact", async () => {
    const { superseded, replacement } = contradictionFacts();
    const store = container.get("STORY_WORLD_STORE");
    await store.commit({
      storyId: fixture.storyId,
      appliedFromRevision: 1,
      newEntityTypes: [],
      entities: [],
      entityUpdates: [],
      events: [],
      facts: [superseded, replacement],
      relationships: [],
      knowledge: [],
      scenes: [],
      plotThreads: [],
      openQuestions: [],
      resolvedOpenQuestionIds: [],
      contradictions: [],
      supersedeFactIds: [],
    });

    const response = await analyze(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/analyze`,
        { analysisType: "contradictions" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(200);
    const { reports } = await response.json();
    expect(reports.some((report: ContinuityReport) => report.category === "contradictions")).toBe(true);
  });

  it("merges LLM-born reports (anachronisms)", async () => {
    const llm: ContinuityReport[] = [
      {
        category: "anachronisms",
        severity: "warning",
        title: "Pocket communicator before its invention",
        description: "Technology appears too early.",
        entityNames: ["Kaden"],
        evidence: ["chapter 2"],
      },
    ];
    const next = await setup({
      llm: new MockLlm({ fixtures: { "ANALYSIS TASK": llm as unknown as never } }),
    });
    setTestContainer(next.container);
    const response = await analyze(
      await jsonRequest(
        `https://example.com/api/stories/${next.storyId}/analyze`,
        { analysisType: "all" },
      ),
      routerCtx({ id: next.storyId }),
    );
    expect(response.status).toBe(200);
    const { reports } = await response.json();
    expect(
      reports.some((report: ContinuityReport) => report.title.includes("Pocket communicator")),
    ).toBe(true);
  });

  it("400s an invalid analysisType", async () => {
    const response = await analyze(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/analyze`,
        { analysisType: "plot-holes" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/stories/[id]/knowledge (T12.7)", () => {
  let fixture: FixtureWorld;
  beforeEach(async () => {
    fixture = await setup();
    setTestContainer(fixture.container);
  });
  afterEach(() => resetTestContainer());

  it("returns the knowledge status for an entity resolved by name", async () => {
    const response = await knowledge(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/knowledge`,
        { entityName: "Sarah", factDescription: "Sarah killed Kaden" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("known");
    expect(body.context).toContain("Sarah killed Kaden");
  });

  it("returns unknown for an unrelated fact", async () => {
    const response = await knowledge(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/knowledge`,
        { entityName: "Sarah", factDescription: "Sarah flies a starship" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("unknown");
  });

  it("404s an unknown entity", async () => {
    const response = await knowledge(
      await jsonRequest(
        `https://example.com/api/stories/${fixture.storyId}/knowledge`,
        { entityName: "Nobody", factDescription: "anything" },
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/hooks/stt-callback (T12.10)", () => {
  let fixture: FixtureWorld;
  let container: TypedContainer<AppRegistry>;
  beforeEach(async () => {
    fixture = await setup({
      config: { WEBHOOK_SECRET: "s3cret" },
      stt: createMockStt({ transcript: "The Relentless sailed at dawn.", durationSeconds: 9 }),
    });
    container = fixture.container;
    setTestContainer(container);
  });
  afterEach(() => resetTestContainer());

  async function createDictationRow(): Promise<string> {
    const store = container.get("TRANSCRIPT_STORE");
    const dictationId = await store.saveDictation({
      storyId: fixture.storyId,
      userId: "u1",
      status: "pending",
    });
    await store.updateDictation(dictationId, { providerJobId: "mock-1" });
    return dictationId;
  }

  it("401s when the webhook secret is missing or wrong", async () => {
    await createDictationRow();
    const request = await jsonRequest("https://example.com/api/hooks/stt-callback", {
      transcript_id: "mock-1",
      status: "completed",
    });
    const response = await sttCallback(request);
    expect(response.status).toBe(401);
  });

  it("404s an unknown transcript_id", async () => {
    const request = new NextRequest("https://example.com/api/hooks/stt-callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "s3cret" },
      body: JSON.stringify({ transcript_id: "other-job", status: "completed" }),
    });
    const response = await sttCallback(request);
    expect(response.status).toBe(404);
  });

  it("saves transcript for review and does not auto-enqueue extraction", async () => {
    const dictationId = await createDictationRow();
    const request = new NextRequest("https://example.com/api/hooks/stt-callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "s3cret" },
      body: JSON.stringify({ transcript_id: "mock-1", status: "completed" }),
    });

    const response = await sttCallback(request);
    expect(response.status).toBe(200);

    const dictation = await container.get("TRANSCRIPT_STORE").getDictation(dictationId);
    expect(dictation?.status).toBe("processing");
    expect(dictation?.transcript).toBe("The Relentless sailed at dawn.");
    expect(dictation?.wordCount).toBe(5);

    const eq = container.get("EXTRACTION_QUEUE") as MockJobQueue;
    const extractionJobs = eq.enqueued.filter((job) => job.jobName === "extraction");
    expect(extractionJobs).toHaveLength(0);
  });
});