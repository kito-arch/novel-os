import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { BASE_KIND_CATALOG } from "@/domain/base-kinds";
import type { MediaRef } from "@/domain/entities";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";
import type { MediaStorage } from "@/server/media-storage";
import { defaultMediaStorage } from "@/server/media-storage";

// T12.9 — Upload media for an entity. multipart/form-data: `file` + `role`
// (portrait | gallery) + optional `caption`. Abstract base kinds are text-only
// (400); one portrait per entity (a new portrait replaces the old).
const roleSchema = z.enum(["portrait", "gallery"]);

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; entityId: string }> },
): Promise<NextResponse> {
  const { id: storyId, entityId } = await ctx.params;
  const guard = await storyGuard(request, storyId);
  if (guard instanceof NextResponse) return guard;
  return handle(request, { storyId, entityId, userId: guard.userId }, defaultMediaStorage);
}

// Storage is the seam route tests stub out when they don't want real files.
export async function handle(
  request: NextRequest,
  params: { storyId: string; entityId: string; userId: string },
  storage: MediaStorage,
): Promise<NextResponse> {
  const { storyId, entityId, userId } = params;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  const world = await store.getWorld(storyId);
  if (!world) return jsonError(404, "story not found");
  const entity = await store.getEntity(storyId, entityId);
  if (!entity) return jsonError(404, "entity not found");

  const entityType = world.entityTypes.find((type) => type.id === entity.entityTypeId);
  if (!entityType) return jsonError(400, "entity has no registered entity type");
  if (!BASE_KIND_CATALOG[entityType.baseKind].supportsMedia) {
    return jsonError(400, `base kind "${entityType.baseKind}" does not support media`);
  }

  const form = await request.formData();
  const file = form.get("file");
  const roleResult = roleSchema.safeParse(form.get("role"));
  const captionEntry = form.get("caption");
  const caption = typeof captionEntry === "string" ? captionEntry : null;
  if (!(file instanceof File)) return jsonError(400, "file required (field name: file)");
  if (!roleResult.success) return jsonError(400, 'role must be "portrait" or "gallery"');

  const role = roleResult.data;
  const buffer = Buffer.from(await file.arrayBuffer());

  const existingMedia = await store.getMedia(entityId);
  if (role === "portrait") {
    const current = existingMedia.find((row: MediaRef) => row.role === "portrait");
    if (current) await store.removeMedia(entityId, current.id);
  }

  const url = await storage.save(buffer, file.name || `${role}.bin`, { userId, storyId });
  const mediaId = await store.attachMedia(entityId, { url, role, caption });
  return NextResponse.json({ id: mediaId, url, role, caption });
}