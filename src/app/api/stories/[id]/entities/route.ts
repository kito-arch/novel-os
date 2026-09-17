import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { coreEntityTypes } from "@/domain/builtins";
import type { Entity } from "@/domain/entities";
import { validateEntity } from "@/domain/entities";
import type { AttributeValue } from "@/domain/entity-types";
import type { Commit } from "@/domain/commits";
import { emptyCommit } from "@/domain/commits";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

interface CreateEntityBody {
  name: string;
  entityTypeName: string;
  aliases?: string[];
  attributes?: Record<string, AttributeValue>;
}

// T16.2 — Direct entity creation (no LLM). Looks up the entity type in the
// story's registry; if it's a builtin type not yet registered it auto-registers
// it (creating the story shell if the story is brand new). Validates attributes
// against the type's attributeDefs, then commits via the normal domain gate.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: storyId } = await ctx.params;
  const guard = await storyGuard(request, storyId);
  if (guard instanceof NextResponse) return guard;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "body must be a JSON object");
  }

  const { name, entityTypeName, aliases = [], attributes = {} } = body as CreateEntityBody;
  if (!name || typeof name !== "string" || !name.trim()) {
    return jsonError(400, "name is required");
  }
  if (!entityTypeName || typeof entityTypeName !== "string") {
    return jsonError(400, "entityTypeName is required");
  }

  let entityType = await store.findEntityTypeByName(storyId, entityTypeName);

  if (!entityType) {
    const builtin = coreEntityTypes.find(
      (t) => t.name.toLowerCase() === entityTypeName.toLowerCase(),
    );
    if (!builtin) {
      return jsonError(404, `entity type "${entityTypeName}" not found in this story's registry`);
    }
    await store.upsertEntityType(storyId, {
      storyId,
      name: builtin.name,
      pluralName: builtin.pluralName,
      baseKind: builtin.baseKind,
      description: builtin.description,
      attributeDefs: builtin.attributeDefs,
      origin: "core",
      supersededBy: null,
    });
    entityType = await store.findEntityTypeByName(storyId, entityTypeName);
    if (!entityType) return jsonError(500, "failed to register entity type");
  }

  const world = await store.getWorld(storyId);
  const revision = world?.revision ?? 0;

  const entity: Entity = {
    id: randomUUID(),
    storyId,
    entityTypeId: entityType.id,
    name: name.trim(),
    aliases: (aliases ?? []).filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()),
    attributes: attributes ?? {},
    media: [],
    createdAt: new Date(),
  };

  const validation = validateEntity(entityType, entity);
  if (!validation.ok) {
    return jsonError(400, validation.errors.map((e) => e.message).join("; "));
  }

  const commit: Commit = { ...emptyCommit(storyId, revision), entities: [entity] };
  await store.commit(commit);

  const created = await store.getEntity(storyId, entity.id);
  return NextResponse.json(created ?? entity, { status: 201 });
}
