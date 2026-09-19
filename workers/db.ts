import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../drizzle/schema";

// Parses a postgres connection URL without relying on the URL class or
// decodeURIComponent, so passwords with special characters (@, #, !, etc.)
// work without requiring percent-encoding from the caller.
//
// Strategy: split at the LAST @ to separate credentials from the host.
// "postgres://user:p@ssw0rd!@host:5432/db" →
//   credentials = "user:p@ssw0rd!"
//   host part   = "host:5432/db"
function parsePostgresUrl(url: string) {
  const withoutScheme = url.replace(/^postgres(?:ql)?:\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  if (lastAt === -1) throw new Error("DATABASE_URL must contain @");

  const credentials = withoutScheme.slice(0, lastAt);
  const hostPart    = withoutScheme.slice(lastAt + 1);

  const colonIdx = credentials.indexOf(":");
  const username = credentials.slice(0, colonIdx);
  const password = credentials.slice(colonIdx + 1); // raw — no encoding required

  const [hostAndPort, ...dbParts] = hostPart.split("/");
  const database = dbParts.join("/").split("?")[0]; // strip query string
  const [host, port] = hostAndPort.split(":");

  return { host, port: port ? parseInt(port, 10) : 5432, database, username, password };
}

export function connectDb(databaseUrl: string) {
  const { host, port, database, username, password } = parsePostgresUrl(databaseUrl);
  return drizzle(
    postgres({ host, port, database, username, password, ssl: "prefer" }),
    { schema },
  );
}
