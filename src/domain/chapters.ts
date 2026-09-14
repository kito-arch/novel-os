import { z } from "zod";

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
  title: z.string(),
  position: z.number().int(),
  createdAt: z.date(),
});
export type Chapter = z.infer<typeof ChapterSchema>;
