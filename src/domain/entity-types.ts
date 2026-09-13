import { z } from "zod";
import { EntityBaseKindSchema } from "./base-kinds";

export const AttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

export const AttributeKindSchema = z.enum([
  "text",
  "number",
  "boolean",
  "enum",
  "ref",
  "timeline",
]);
export type AttributeKind = z.infer<typeof AttributeKindSchema>;

export const MULTI_ALLOWED_KINDS: readonly AttributeKind[] = [
  "text",
  "number",
  "enum",
  "ref",
];

export const AttributeDefSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    kind: AttributeKindSchema,
    required: z.boolean().default(false),
    multi: z.boolean().default(false),
    enumValues: z.array(z.string()).optional(),
    refType: z.string().optional(),
  })
  .superRefine((def, ctx) => {
    if (def.multi && !MULTI_ALLOWED_KINDS.includes(def.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["multi"],
        message: `kind "${def.kind}" does not support multi-valued attributes`,
      });
    }
    if (def.kind === "enum" && !def.enumValues?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enumValues"],
        message: 'kind "enum" requires enumValues',
      });
    }
    if (def.kind !== "enum" && def.enumValues !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enumValues"],
        message: 'enumValues is only allowed for kind "enum"',
      });
    }
    if (def.kind === "ref" && !def.refType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refType"],
        message: 'kind "ref" requires refType',
      });
    }
    if (def.kind !== "ref" && def.refType !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refType"],
        message: 'refType is only allowed for kind "ref"',
      });
    }
  });
export type AttributeDef = z.infer<typeof AttributeDefSchema>;

export const EntityTypeSchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid().nullable().default(null),
  name: z.string().min(1),
  pluralName: z.string().min(1),
  baseKind: EntityBaseKindSchema,
  description: z.string().nullable().default(null),
  attributeDefs: z.array(AttributeDefSchema).default([]),
  origin: z.enum(["core", "preset", "extracted", "user"]),
  supersededBy: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type EntityType = z.infer<typeof EntityTypeSchema>;