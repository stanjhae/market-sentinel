import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function shouldRequireSsl(args: { connectionString: string; nodeEnv?: string }): boolean {
  const params = args.connectionString.split("?")[1] ?? "";
  if (/(?:^|&)sslmode=disable(?:&|$)/i.test(params)) {
    return false;
  }
  if (/(?:^|&)sslmode=(?:require|verify-ca|verify-full)(?:&|$)/i.test(params)) {
    return true;
  }
  return args.nodeEnv === "production";
}

export function postgresSslOption(args: { connectionString: string; nodeEnv?: string }): true | undefined {
  return shouldRequireSsl(args) ? true : undefined;
}

export function createDb(connectionString: string, args: { nodeEnv?: string } = {}) {
  const client = postgres(connectionString, {
    max: 4,
    ssl: postgresSslOption({
      connectionString,
      nodeEnv: args.nodeEnv ?? process.env.NODE_ENV,
    }),
  });
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof createDb>["db"];
