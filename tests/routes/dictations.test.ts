import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { AppRegistry } from "@/container";
import type { TypedContainer } from "@evyweb/ioctopus";
import { setTestContainer, resetTestContainer } from "@/server/app-container";
import { POST as createDictation } from "@/app/api/dictations/route";
import { GET as getDictation } from "@/app/api/dictations/[id]/route";
import { MockJobQueue } from "../mocks";
import { setup } from "./fixtures";

const STORY_ID = "fc4c55da-65b5-401d-812a-eff0cc6ef001";

function audioForm(storyId: string, body: string): NextRequest {
  const form = new FormData();
  form.append("audio", new File([body], "chapter.mp3", { type: "audio/mpeg" }));
  form.append("storyId", storyId);
  return new NextRequest("https://example.com/api/dictations", {
    method: "POST",
    headers: { "x-user-id": "u1" },
    body: form,
  });
}

describe("POST /api/dictations (T12.1)", () => {
  let container: TypedContainer<AppRegistry>;
  beforeEach(async () => {
    container = (await setup()).container;
    setTestContainer(container);
  });
  afterEach(() => resetTestContainer());

  it("requires authentication", async () => {
    const form = new FormData();
    form.append("audio", new File(["x"], "a.mp3"));
    form.append("storyId", STORY_ID);
    const request = new NextRequest("https://example.com/api/dictations", { method: "POST", body: form });
    const response = await createDictation(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it("saves audio, creates a pending dictation, and enqueues a transcription job", async () => {
    const response = await createDictation(audioForm(STORY_ID, "Sarah boarded the Relentless."));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dictationId).toBeTruthy();
    // providerJobId is set by the transcription worker, not the HTTP route
    expect(body.jobId).toBeUndefined();

    const dictation = await container.get("TRANSCRIPT_STORE").getDictation(body.dictationId);
    expect(dictation?.userId).toBe("u1");
    expect(dictation?.storyId).toBe(STORY_ID);
    expect(dictation?.status).toBe("pending");
    expect(dictation?.providerJobId).toBeNull();

    const tq = container.get("TRANSCRIPTION_QUEUE") as MockJobQueue;
    expect(tq.enqueued).toHaveLength(1);
    expect(tq.enqueued[0]?.jobName).toBe("transcription");
  });

  it("passes a clean webhook URL (no query params) inside the transcription job", async () => {
    const response = await createDictation(audioForm(STORY_ID, "hello"));
    expect(response.status).toBe(200);
    const { dictationId } = await response.json();
    expect(dictationId).toBeTruthy();

    const tq = container.get("TRANSCRIPTION_QUEUE") as MockJobQueue;
    const job = tq.enqueued[0]?.data as { webhookUrl?: string };
    expect(job?.webhookUrl).toMatch(/^https?:\/\/[^?]+\/api\/hooks\/stt-callback$/);
  });

  it("rejects a missing audio file", async () => {
    const form = new FormData();
    form.append("storyId", STORY_ID);
    const request = new NextRequest("https://example.com/api/dictations", {
      method: "POST",
      headers: { "x-user-id": "u1" },
      body: form,
    });
    const response = await createDictation(request);
    expect(response.status).toBe(400);
  });

  it("rejects a missing storyId", async () => {
    const form = new FormData();
    form.append("audio", new File(["x"], "a.mp3"));
    const request = new NextRequest("https://example.com/api/dictations", {
      method: "POST",
      headers: { "x-user-id": "u1" },
      body: form,
    });
    const response = await createDictation(request);
    expect(response.status).toBe(400);
  });
});

describe("GET /api/dictations/[id] (T12.2)", () => {
  let container: TypedContainer<AppRegistry>;
  beforeEach(async () => {
    container = (await setup()).container;
    setTestContainer(container);
  });
  afterEach(() => resetTestContainer());

  it("returns the persisted status and the commit summary once completed", async () => {
    const dictationId = await container.get("TRANSCRIPT_STORE").saveDictation({
      storyId: STORY_ID,
      userId: "u1",
      status: "completed",
      transcript: "Sarah boarded the Relentless.",
      wordCount: 4,
      summary: {
        revision: 3,
        entityTypesCreated: 0,
        entitiesCreated: 1,
        entitiesUpdated: 0,
        entitiesCreatedByType: { starship: 1 },
        eventsAdded: 2,
        factsAdded: 0,
        relationshipsAdded: 0,
        knowledgeAdded: 0,
        scenesAdded: 1,
        plotThreadsUpdated: 0,
        openQuestionsAdded: 0,
        openQuestionsResolved: 0,
        contradictionsFound: 1,
        factsSuperseded: 0,
      },
    });
    const response = await getDictation(
      new NextRequest(`https://example.com/api/dictations/${dictationId}`),
      { params: Promise.resolve({ id: dictationId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("completed");
    expect(body.wordCount).toBe(4);
    expect(body.summary.entitiesCreatedByType).toEqual({ starship: 1 });
    expect(body.summary.contradictionsFound).toBe(1);
  });

  it("404s an unknown dictation", async () => {
    const response = await getDictation(
      new NextRequest("https://example.com/api/dictations/unknown"),
      { params: Promise.resolve({ id: "not-a-real-id" }) },
    );
    expect(response.status).toBe(404);
  });
});