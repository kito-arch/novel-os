import { NextResponse, type NextRequest } from "next/server";
import type { Entity, MediaRef } from "@/domain/entities";
import { validateEntity } from "@/domain/entities";
import type { AttributeValue } from "@/domain/entity-types";
import type { StoryWorldStore } from "@/container/story-world-store";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

interface EntityPatchBody {
  attributes?: Record<string, AttributeValue>;
  aliases?: string[];
  media?: Array<Partial<MediaRef> & { url: string; role: "portrait" | "gallery" }>;
}

// T12.4 — Manual entity edit (the "write it yourself" flow). Accepts partial
// updates over `attributes` (merged onto the entity), `aliases` (replacement),
// and `media` (full list sync). Validation runs through the entity's own
// EntityType def (validateEntity) and the change applies as a normal world
// commit, which bumps the revision and records the snapshot.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; entityId: string }> },
): Promise<NextResponse> {
  const { id: storyId, entityId } = await ctx.params;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  const world = await store.getWorld(storyId);
  if (!world) return jsonError(404, "story not found");

  const entity = await store.getEntity(storyId, entityId);
  if (!entity) return jsonError(404, "entity not found");

  const entityType = world.entityTypes.find((type) => type.id === entity.entityTypeId);
  if (!entityType) return jsonError(400, "entity has no registered entity type");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "body must be a JSON object");
  }
  const updates = body as EntityPatchBody;

  const attributes: Record<string, AttributeValue> = updates.attributes === undefined
    ? entity.attributes
    : { ...entity.attributes, ...updates.attributes };

  const aliases = updates.aliases === undefined ? entity.aliases : updates.aliases;

  const entityForCommit: Entity = updates.media === undefined
    ? { ...entity, attributes, aliases, media: entity.media }
    : { ...entity, attributes, aliases, media: await syncMedia(store, entityId, entity.media, updates.media) };

  const validation = validateEntity(entityType, entityForCommit);
  if (!validation.ok) {
    return jsonError(400, validation.errors.map((error) => error.message).join("; "));
  }

  await store.commit({
    storyId,
    appliedFromRevision: world.revision,
    newEntityTypes: [],
    entities: [],
    entityUpdates: [entityForCommit],
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

  const updated = await store.getEntity(storyId, entityId);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; entityId: string }> },
): Promise<NextResponse> {
  const { id: storyId, entityId } = await ctx.params;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  const entity = await store.getEntity(storyId, entityId);
  if (!entity) return jsonError(404, "entity not found");

  // Block deletion if the entity is referenced in any scene prose.
  const [scenes, chapters] = await Promise.all([
    store.listProseScenes(storyId),
    store.listChapters(storyId),
  ]);
  const referencingScenes = scenes.filter((s) => s.content?.includes(`(${entityId})`));
  if (referencingScenes.length > 0) {
    const chapterById = new Map(chapters.map((c) => [c.id, c]));
    const refs = referencingScenes.map((s) => {
      const ch = s.chapterId ? chapterById.get(s.chapterId) : undefined;
      return `"${s.title ?? "Untitled scene"}"${ch ? ` (${ch.title})` : ""}`;
    });
    return jsonError(
      409,
      `Cannot delete "${entity.name}" — it is referenced in ${refs.length} scene(s): ${refs.join(", ")}. Remove the @mentions first.`,
    );
  }

  await store.deleteEntity(storyId, entityId);
  return new NextResponse(null, { status: 204 });
}

// Media list sync: entries already on the entity are kept, new entries are
// attached, and anything absent from the desired list is removed. The response
// carries store-assigned ids so a subsequent read reflects exactly this list.
async function syncMedia(
  store: StoryWorldStore,
  entityId: string,
  current: MediaRef[],
  desired: Array<Partial<MediaRef> & { url: string; role: "portrait" | "gallery" }>,
): Promise<MediaRef[]> {
  const next: MediaRef[] = [];
  const currentById = new Map(current.map((row) => [row.id, row]));

  for (const item of desired) {
    if (item.id && currentById.has(item.id)) {
      const existing = currentById.get(item.id)!;
      next.push({ ...existing, ...item, id: existing.id, createdAt: existing.createdAt });
    } else {
      const id = await store.attachMedia(entityId, {
        url: item.url,
        role: item.role,
        caption: item.caption ?? null,
      });
      next.push({ id, url: item.url, role: item.role, caption: item.caption ?? null, createdAt: new Date() });
    }
  }

  const desiredIds = new Set(next.map((row) => row.id));
  for (const row of current) {
    if (!desiredIds.has(row.id)) {
      await store.removeMedia(entityId, row.id);
    }
  }
  return next;
}