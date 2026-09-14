import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { EntityBaseKindSchema } from "@/domain/base-kinds";
import { AttributeDefSchema } from "@/domain/entity-types";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

// T12.8 — User-created entity types ($5.3). Registers a new type with
// origin "user" after validating baseKind (against the base-kind catalog) and
// the attribute defs (Zod). Name uniqueness is the store's own guard.
const CreateEntityTypeSchema = z.object({
  name: z.string().min(1),
  pluralName: z.string().min(1),
  baseKind: EntityBaseKindSchema,
  description: z.string().nullish(),
  attributeDefs: z.array(AttributeDefSchema).default([]),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const store = resolveContainer().get("STORY_WORLD_STORE");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = CreateEntityTypeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "invalid entity type definition");
  }

  const existing = await store.findEntityTypeByName(id, parsed.data.name);
  if (existing) {
    return jsonError(409, `entity type "${parsed.data.name}" already exists`);
  }

  const entityTypeId = await store.upsertEntityType(id, {
    storyId: id,
    name: parsed.data.name,
    pluralName: parsed.data.pluralName,
    baseKind: parsed.data.baseKind,
    description: parsed.data.description ?? null,
    attributeDefs: parsed.data.attributeDefs,
    origin: "user",
    supersededBy: null,
  });

  return NextResponse.json({ id: entityTypeId });
}