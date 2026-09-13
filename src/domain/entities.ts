import { z } from "zod";
import { BASE_KIND_CATALOG } from "./base-kinds";
import { AttributeValueSchema } from "./entity-types";
import type { AttributeDef, AttributeKind, AttributeValue, EntityType } from "./entity-types";

export const MediaRefSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  role: z.enum(["portrait", "gallery"]),
  caption: z.string().nullable().default(null),
  createdAt: z.date(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const EntitySchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
  entityTypeId: z.string().uuid(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  attributes: z.record(z.string(), AttributeValueSchema).default({}),
  media: z.array(MediaRefSchema).default([]),
  createdAt: z.date(),
});
export type Entity = z.infer<typeof EntitySchema>;

export interface AttributeError {
  path: string;
  message: string;
}

export type AttributesValidationResult =
  | { ok: true; attributes: Record<string, AttributeValue> }
  | { ok: false; errors: AttributeError[] };

export type EntityValidationResult =
  | { ok: true; attributes: Record<string, AttributeValue>; media: MediaRef[] }
  | { ok: false; errors: AttributeError[] };

function expectedType(kind: AttributeKind): string {
  switch (kind) {
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    default:
      return "a string";
  }
}

function validateScalar(
  value: AttributeValue,
  def: AttributeDef,
  path: string,
  errors: AttributeError[],
): void {
  const typeError = (expected: string, actual: string): void => {
    errors.push({
      path,
      message: `expected ${expected} but received ${actual}`,
    });
  };

  if (value === null) {
    if (def.required) errors.push({ path, message: "required attribute cannot be null" });
    return;
  }

  if (def.kind === "number" && typeof value !== "number") {
    typeError(expectedType(def.kind), typeof value);
    return;
  }
  if (def.kind === "boolean" && typeof value !== "boolean") {
    typeError(expectedType(def.kind), typeof value);
    return;
  }
  if (
    (def.kind === "text" || def.kind === "ref" || def.kind === "enum" || def.kind === "timeline") &&
    typeof value !== "string"
  ) {
    typeError(expectedType(def.kind), typeof value);
    return;
  }
  if (def.kind === "enum" && def.enumValues && !def.enumValues.includes(value as string)) {
    errors.push({ path, message: `"${value}" is not a valid ${def.label} option` });
  }
}

export function validateAttributes(
  entityType: EntityType,
  attributes: Record<string, AttributeValue>,
): AttributesValidationResult {
  const errors: AttributeError[] = [];
  const defs = new Map(entityType.attributeDefs.map((def) => [def.key, def]));

  for (const key of Object.keys(attributes)) {
    if (!defs.has(key)) {
      errors.push({ path: key, message: `attribute "${key}" is not declared by entity type "${entityType.name}"` });
    }
  }

  for (const def of entityType.attributeDefs) {
    const value = attributes[def.key];
    if (value === undefined || value === null) {
      if (def.required) errors.push({ path: def.key, message: `missing required attribute "${def.key}"` });
      continue;
    }

    if (def.multi) {
      if (!Array.isArray(value)) {
        errors.push({ path: def.key, message: `attribute "${def.key}" is multi-valued and expects an array` });
        continue;
      }
      if (value.length === 0 && def.required) {
        errors.push({ path: def.key, message: `missing required attribute "${def.key}"` });
        continue;
      }
      value.forEach((element, index) =>
        validateScalar(element, def, `${def.key}[${index}]`, errors),
      );
    } else {
      if (Array.isArray(value)) {
        errors.push({ path: def.key, message: `attribute "${def.key}" expects a single value, not an array` });
        continue;
      }
      validateScalar(value, def, def.key, errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, attributes };
}

export function validateEntity(
  entityType: EntityType,
  entity: { attributes: Record<string, AttributeValue>; media: MediaRef[] },
): EntityValidationResult {
  const attributesResult = validateAttributes(entityType, entity.attributes);
  if (!attributesResult.ok) return attributesResult;

  const supportsMedia = BASE_KIND_CATALOG[entityType.baseKind].supportsMedia;
  if (entity.media.length > 0 && !supportsMedia) {
    return {
      ok: false,
      errors: [
        {
          path: "media",
          message: `entity type "${entityType.name}" has baseKind "${entityType.baseKind}" which does not support media`,
        },
      ],
    };
  }

  return { ok: true, attributes: attributesResult.attributes, media: entity.media };
}