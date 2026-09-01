import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const { client, db } = createDb(url);
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await client.end();
}

void main();
