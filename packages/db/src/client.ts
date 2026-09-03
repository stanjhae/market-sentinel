import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const SUPABASE_CA_PATH = join(dirname(fileURLToPath(import.meta.url)), "../certs/supabase-ca-2021.pem");

export function postgresConnectionPort(args: { connectionString: string }): number | null {
  try {
    const parsed = new URL(args.connectionString);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:" ? 5432 : null;
  } catch {
    return null;
  }
}

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

export function isSupabaseConnection(args: { connectionString: string }): boolean {
  try {
    const host = new URL(args.connectionString).hostname.toLowerCase();
    return host.endsWith(".supabase.com") || host.endsWith(".supabase.co") || host === "supabase.com" || host === "supabase.co";
  } catch {
    return false;
  }
}

export function loadSupabaseCaPem(args: { path?: string } = {}): string {
  return readFileSync(args.path ?? SUPABASE_CA_PATH, "utf8");
}

export function postgresSslOption(args: {
  connectionString: string;
  nodeEnv?: string;
  supabaseCaPem?: string;
}): true | { rejectUnauthorized: true; ca?: string } | undefined {
  if (!shouldRequireSsl(args)) {
    return undefined;
  }
  if (isSupabaseConnection({ connectionString: args.connectionString })) {
    return {
      rejectUnauthorized: true,
      ca: args.supabaseCaPem ?? loadSupabaseCaPem(),
    };
  }
  return { rejectUnauthorized: true };
}

export function postgresPrepareEnabled(args: { connectionString: string }): boolean {
  return postgresConnectionPort({ connectionString: args.connectionString }) !== 6543;
}

export function createDb(connectionString: string, args: { nodeEnv?: string } = {}) {
  const client = postgres(connectionString, {
    max: 4,
    prepare: postgresPrepareEnabled({ connectionString }),
    ssl: postgresSslOption({
      connectionString,
      nodeEnv: args.nodeEnv ?? process.env.NODE_ENV,
    }),
  });
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof createDb>["db"];
