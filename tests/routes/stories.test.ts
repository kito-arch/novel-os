import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AppRegistry } from "@/container";
import type { TypedContainer } from "@evyweb/ioctopus";
import { setTestContainer, resetTestContainer } from "@/server/app-container";
import { GET as getStory } from "@/app/api/stories/[id]/route";
import { PATCH as patchEntity } from "@/app/api/stories/[id]/entities/[entityId]/route";
import { POST as createEntityType } from "@/app/api/stories/[id]/entity-types/route";
import { handle as createMedia } from "@/app/api/stories/[id]/entities/[entityId]/media/route";
import { setup, type FixtureWorld } from "./fixtures";

interface MediaStorageStub {
  save: (buffer: Buffer, originalName: string) => Promise<string>;
}

function routerCtx<P extends Record<string, string>>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

async function mockBody(method: string, body: unknown, url: string, headers: Record<string, string> = {}): Promise<NextRequest> {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/stories/[id] (T12.3)", () => {
  let fixture: FixtureWorld;
  beforeEach(async () => {
    fixture = await setup();
    setTestContainer(fixture.container);
  });
  afterEach(() => resetTestContainer());

  it("returns the full StoryWorld", async () => {
    const response = await getStory(
      new NextRequest(`https://example.com/api/stories/${fixture.storyId}`),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(200);
    const world = await response.json();
    expect(world.id).toBe(fixture.storyId);
    expect(world.entityTypes.some((type: { name: string }) => type.name === "character")).toBe(true);
    expect(world.entities.map((e: { name: string }) => e.name)).toEqual(["Sarah", "Kaden"]);
  });

  it("404s an unknown story", async () => {
    const response = await getStory(
      new NextRequest("https://example.com/api/stories/unknown"),
      routerCtx({ id: "not-a-story" }),
    );
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/stories/[id]/entities/[entityId] (T12.4)", () => {
  let fixture: FixtureWorld;
  let container: TypedContainer<AppRegistry>;
  beforeEach(async () => {
    fixture = await setup();
    container = fixture.container;
    setTestContainer(container);
  });
  afterEach(() => resetTestContainer());

  it("updates entity attributes via a world commit and bumps the revision", async () => {
    const before = await container.get("STORY_WORLD_STORE").getWorld(fixture.storyId);
    const response = await patchEntity(
      await mockBody(
        "PATCH",
        { attributes: { goals: "Reach the far shore" } },
        `https://example.com/api/stories/${fixture.storyId}/entities/${fixture.sarah.id}`,
      ),
      routerCtx({ id: fixture.storyId, entityId: fixture.sarah.id }),
    );
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.attributes.goals).toBe("Reach the far shore");

    const after = await container.get("STORY_WORLD_STORE").getWorld(fixture.storyId);
    expect(after?.revision).toBe((before?.revision ?? 0) + 1);
  });

  it("replaces aliases when provided", async () => {
    const response = await patchEntity(
      await mockBody(
        "PATCH",
        { aliases: ["Sare"] },
        `https://example.com/api/stories/${fixture.storyId}/entities/${fixture.sarah.id}`,
      ),
      routerCtx({ id: fixture.storyId, entityId: fixture.sarah.id }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).aliases).toEqual(["Sare"]);
  });

  it("rejects undeclared attributes", async () => {
    const response = await patchEntity(
      await mockBody(
        "PATCH",
        { attributes: { sneaky: "not declared" } },
        `https://example.com/api/stories/${fixture.storyId}/entities/${fixture.sarah.id}`,
      ),
      routerCtx({ id: fixture.storyId, entityId: fixture.sarah.id }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not declared/);
  });

  it("404s an unknown entity", async () => {
    const response = await patchEntity(
      await mockBody("PATCH", { aliases: [] }, `https://example.com/api/stories/${fixture.storyId}/entities/unknown`),
      routerCtx({ id: fixture.storyId, entityId: "unknown" }),
    );
    expect(response.status).toBe(404);
  });

  it("syncs the media list through attach + remove", async () => {
    const store = container.get("STORY_WORLD_STORE");
    const mediaId = await store.attachMedia(fixture.sarah.id, {
      url: "s3://bucket/old.jpg",
      role: "gallery",
      caption: null,
    });
    const response = await patchEntity(
      await mockBody(
        "PATCH",
        {
          media: [
            { id: mediaId, url: "s3://bucket/old.jpg", role: "gallery", caption: null },
            { url: "s3://bucket/new.jpg", role: "gallery", caption: "Fresh capture" },
          ],
        },
        `https://example.com/api/stories/${fixture.storyId}/entities/${fixture.sarah.id}`,
      ),
      routerCtx({ id: fixture.storyId, entityId: fixture.sarah.id }),
    );
    expect(response.status).toBe(200);
    const media = await store.getMedia(fixture.sarah.id);
    expect(media).toHaveLength(2);
    expect(media.map((row) => row.url).sort()).toEqual([
      "s3://bucket/new.jpg",
      "s3://bucket/old.jpg",
    ]);
  });
});

describe("POST /api/stories/[id]/entity-types (T12.8)", () => {
  let fixture: FixtureWorld;
  beforeEach(async () => {
    fixture = await setup();
    setTestContainer(fixture.container);
  });
  afterEach(() => resetTestContainer());

  it("registers a user-created starship type", async () => {
    const response = await createEntityType(
      await mockBody(
        "POST",
        {
          name: "starship",
          pluralName: "starships",
          baseKind: "physical",
          description: "Spacefaring vessels",
          attributeDefs: [
            { key: "class", label: "Class", kind: "text", required: true, multi: false },
            { key: "armament", label: "Armament", kind: "text", required: false, multi: true },
          ],
        },
        `https://example.com/api/stories/${fixture.storyId}/entity-types`,
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(200);
    const { id } = await response.json();
    const type = await fixture.container
      .get("STORY_WORLD_STORE")
      .findEntityTypeByName(fixture.storyId, "starship");
    expect(type?.id).toBe(id);
    expect(type?.origin).toBe("user");
  });

  it("rejects an invalid baseKind", async () => {
    const response = await createEntityType(
      await mockBody(
        "POST",
        { name: "weird", pluralName: "weirds", baseKind: "not-a-kind" },
        `https://example.com/api/stories/${fixture.storyId}/entity-types`,
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a duplicate type name", async () => {
    await fixture.container
      .get("STORY_WORLD_STORE")
      .upsertEntityType(fixture.storyId, {
        storyId: fixture.storyId,
        name: "starship",
        pluralName: "starships",
        baseKind: "physical",
        description: null,
        attributeDefs: [],
        origin: "user",
        supersededBy: null,
      });
    const response = await createEntityType(
      await mockBody(
        "POST",
        { name: "starship", pluralName: "starships", baseKind: "physical" },
        `https://example.com/api/stories/${fixture.storyId}/entity-types`,
      ),
      routerCtx({ id: fixture.storyId }),
    );
    expect(response.status).toBe(409);
  });
});

describe("POST /api/stories/[id]/entities/[entityId]/media (T12.9)", () => {
  let fixture: FixtureWorld;
  let storage: MediaStorageStub;
  beforeEach(async () => {
    fixture = await setup();
    setTestContainer(fixture.container);
    storage = { save: async (_buffer, name) => `file:///mock/${name}` };
  });
  afterEach(() => resetTestContainer());

  function mediaRequest(entityId: string, role: string, caption: string | null): NextRequest {
    const form = new FormData();
    form.append("file", new File(["data"], "pic.jpg", { type: "image/jpeg" }));
    form.append("role", role);
    if (caption !== null) form.append("caption", caption);
    return new NextRequest(
      `https://example.com/api/stories/${fixture.storyId}/entities/${entityId}/media`,
      { method: "POST", body: form },
    );
  }

  // The route exports both the Next handler (POST) and a testable `handle`
  // with an injected storage. Call the import's handle with a stub storage.
  it("attaches a gallery image to a character", async () => {
    const response = await createMedia(
      mediaRequest(fixture.sarah.id, "gallery", "Docks at dawn"),
      { storyId: fixture.storyId, entityId: fixture.sarah.id },
      storage,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.role).toBe("gallery");
    expect(body.caption).toBe("Docks at dawn");
    const media = await fixture.container.get("STORY_WORLD_STORE").getMedia(fixture.sarah.id);
    expect(media).toHaveLength(1);
    expect(media[0].url).toContain("pic.jpg");
  });

  it("keeps only one portrait (new portrait replaces old)", async () => {
    const store = fixture.container.get("STORY_WORLD_STORE");
    await store.attachMedia(fixture.sarah.id, {
      url: "s3://bucket/old-portrait.jpg",
      role: "portrait",
      caption: null,
    });
    const response = await createMedia(
      mediaRequest(fixture.sarah.id, "portrait", null),
      { storyId: fixture.storyId, entityId: fixture.sarah.id },
      storage,
    );
    expect(response.status).toBe(200);
    const media = await store.getMedia(fixture.sarah.id);
    expect(media).toHaveLength(1);
    expect(media[0].role).toBe("portrait");
    expect(media[0].url).not.toContain("old-portrait");
  });

  it("rejects media for an abstract entity", async () => {
    const store = fixture.container.get("STORY_WORLD_STORE");
    await store.upsertEntityType(fixture.storyId, {
      storyId: fixture.storyId,
      name: "faction",
      pluralName: "factions",
      baseKind: "abstract",
      description: null,
      attributeDefs: [],
      origin: "user",
      supersededBy: null,
    });
    await store.commit({
      storyId: fixture.storyId,
      appliedFromRevision: 1,
      newEntityTypes: [],
      entities: [
        {
          id: randomUUID(),
          storyId: fixture.storyId,
          entityTypeId: (await store.findEntityTypeByName(fixture.storyId, "faction"))!.id,
          name: "The Coalition",
          aliases: [],
          attributes: {},
          media: [],
          createdAt: new Date(),
        },
      ],
      entityUpdates: [],
      events: [],
      facts: [],
      relationships: [],
      knowledge: [],
      scenes: [],
      plotThreads: [],
      openQuestions: [],
      resolvedOpenQuestionIds: [],
      contradictions: [],
      supersedeFactIds: [],
    });

    const faction = (await store.findEntityByName(fixture.storyId, "The Coalition"))!;
    const response = await createMedia(
      mediaRequest(faction.id, "gallery", null),
      { storyId: fixture.storyId, entityId: faction.id },
      storage,
    );
    expect(response.status).toBe(400);
  });

  it("rejects an invalid role", async () => {
    const response = await createMedia(
      mediaRequest(fixture.sarah.id, "banner", null),
      { storyId: fixture.storyId, entityId: fixture.sarah.id },
      storage,
    );
    expect(response.status).toBe(400);
  });
});