import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const caddyfile = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/docker/Caddyfile"), "utf8");

describe("production Caddyfile", () => {
  it("does not gzip the API path that serves SSE", () => {
    const apiStart = caddyfile.indexOf("handle /sentinel-api");
    const webStart = caddyfile.indexOf("handle {");
    expect(apiStart).toBeGreaterThan(-1);
    expect(webStart).toBeGreaterThan(apiStart);
    expect(caddyfile.slice(apiStart, webStart)).not.toMatch(/encode\s+gzip/);
    expect(caddyfile.slice(webStart)).toMatch(/encode\s+gzip/);
  });
});
