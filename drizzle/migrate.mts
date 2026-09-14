import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is required to run migrations. Set it in .env or the shell, e.g. DATABASE_URL=postgres://localhost:5432/novelos",
  );
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: "drizzle/migrations" });
  console.log("Migrations applied against", url);
} finally {
  await client.end();
}