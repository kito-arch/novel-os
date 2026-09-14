-- Chapter records: ordered containers for prose scenes.
CREATE TABLE "chapters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "story_id" uuid NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Prose content on scenes: the actual written narrative.
ALTER TABLE "scenes" ADD COLUMN "content" text;
ALTER TABLE "scenes" ADD COLUMN "chapter_id" uuid REFERENCES "chapters"("id") ON DELETE SET NULL;
ALTER TABLE "scenes" ADD COLUMN "position" integer NOT NULL DEFAULT 0;
