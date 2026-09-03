import { describe, expect, it } from "vitest";
import { postgresPrepareEnabled, postgresSslOption, shouldRequireSsl } from "./client.js";
import { instruments, auditLogs, candles, indicatorSnapshots, pivots, priceZones, marketRegimes, signals, alerts, appSettings, journalEntries, backtestRuns, brokerOrders } from "./schema.js";

describe("schema", () => {
  it("defines instrument, candle, and audit tables", () => {
    expect(instruments).toBeDefined();
    expect(auditLogs).toBeDefined();
    expect(candles).toBeDefined();
    expect(indicatorSnapshots).toBeDefined();
    expect(pivots).toBeDefined();
    expect(priceZones).toBeDefined();
    expect(marketRegimes).toBeDefined();
    expect(signals).toBeDefined();
    expect(alerts).toBeDefined();
    expect(appSettings).toBeDefined();
    expect(journalEntries).toBeDefined();
    expect(backtestRuns).toBeDefined();
    expect(brokerOrders).toBeDefined();
  });

  it("requires TLS in production unless sslmode=disable", () => {
    expect(
      shouldRequireSsl({
        connectionString: "postgres://sentinel@db.example:5432/app",
        nodeEnv: "production",
      }),
    ).toBe(true);
    expect(
      shouldRequireSsl({
        connectionString: "postgres://sentinel@localhost:5432/app",
        nodeEnv: "test",
      }),
    ).toBe(false);
    expect(
      shouldRequireSsl({
        connectionString: "postgres://sentinel@db.example:5432/app?sslmode=require",
        nodeEnv: "development",
      }),
    ).toBe(true);
    expect(
      shouldRequireSsl({
        connectionString: "postgres://sentinel@db.example:5432/app?sslmode=disable",
        nodeEnv: "production",
      }),
    ).toBe(false);
    expect(
      postgresSslOption({
        connectionString: "postgres://sentinel@db.example:5432/app",
        nodeEnv: "production",
      }),
    ).toBe(true);
    expect(
      postgresSslOption({
        connectionString: "postgres://sentinel@localhost:5432/app",
        nodeEnv: "test",
      }),
    ).toBeUndefined();
    expect(
      postgresSslOption({
        connectionString: "postgres://sentinel@db.example:5432/app?sslmode=require",
        nodeEnv: "production",
      }),
    ).toEqual({ rejectUnauthorized: false });
    expect(
      postgresPrepareEnabled({
        connectionString: "postgres://postgres.proj@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
      }),
    ).toBe(false);
    expect(
      postgresPrepareEnabled({
        connectionString: "postgres://postgres.proj@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require",
      }),
    ).toBe(true);
  });
});
