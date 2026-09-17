ALTER TABLE "events" ADD COLUMN "scene_id" uuid REFERENCES "scenes"("id") ON DELETE SET NULL;
