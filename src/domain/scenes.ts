import { z } from "zod";
import { TimelineRefSchema } from "./events";

export const SceneSchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
  title: z.string().nullable().default(null),
  settingId: z.string().uuid().nullable().default(null),
  when: TimelineRefSchema.nullable().default(null),
  summary: z.string().nullable().default(null),
  chapterNumber: z.number().nullable().default(null),
  chapterId: z.string().uuid().nullable().default(null),
  position: z.number().int().default(0),
  content: z.string().nullable().default(null),
  eventIds: z.array(z.string().uuid()).default([]),
  participantIds: z.array(z.string().uuid()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Scene = z.infer<typeof SceneSchema>;