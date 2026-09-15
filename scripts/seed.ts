// Development seed: creates a sample story with a character so new contributors
// have something to explore immediately after running migrations.
// Usage: DATABASE_URL=postgres://localhost:5432/novelos npx tsx scripts/seed.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../drizzle/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const OWNER_ID = "seed-user";
const now = new Date();

const [story] = await db.insert(schema.stories)
  .values({ title: "Sample Story", ownerId: OWNER_ID, updatedAt: now })
  .returning({ id: schema.stories.id })
  .onConflictDoNothing();

if (!story) {
  console.log("Seed story already exists — skipping.");
  await client.end();
  process.exit(0);
}

const [entityType] = await db.insert(schema.entityTypes)
  .values({
    storyId: story.id,
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    origin: "core",
    attributeDefs: [],
  })
  .returning({ id: schema.entityTypes.id });

await db.insert(schema.entities).values({
  storyId: story.id,
  entityTypeId: entityType.id,
  name: "Aria Voss",
  aliases: [],
  attributes: {},
});

console.log(`Seeded story "${story.id}" with character "Aria Voss" for owner "${OWNER_ID}".`);
await client.end();
