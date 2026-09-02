import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectImageKind,
  isSafeJournalId,
  parseJournalPatch,
  resolveScreenshotPath,
  screenshotDir,
} from "./journal.js";

describe("journal patch", () => {
  it("accepts notes and a manual unlink", () => {
    const parsed = parseJournalPatch({
      body: { notes: "too fast", followedPlan: false, tradePlanId: null, ruleBreaks: ["chase"] },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.tradePlanId).toBeNull();
      expect(parsed.value.ruleBreaks).toEqual(["chase"]);
    }
  });

  it("rejects an unknown field type", () => {
    expect(parseJournalPatch({ body: { followedPlan: "yes" } }).ok).toBe(false);
  });
});

describe("journal screenshot confinement", () => {
  it("rejects traversal and non-uuid ids", () => {
    expect(isSafeJournalId({ id: "../etc/passwd" })).toBe(false);
    expect(isSafeJournalId({ id: "not-a-uuid" })).toBe(false);
    expect(resolveScreenshotPath({ id: "../secret", ext: "png" })).toBeNull();
    expect(resolveScreenshotPath({ id: "abc", ext: "png" })).toBeNull();
    expect(resolveScreenshotPath({ id: "00000000-0000-4000-8000-000000000000", ext: "../png" })).toBeNull();
  });

  it("resolves uuid files under the repo screenshot directory", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const resolved = resolveScreenshotPath({ id, ext: "png" });
    expect(resolved).toBe(path.join(screenshotDir(), `${id}.png`));
    expect(resolved?.startsWith(screenshotDir())).toBe(true);
    expect(screenshotDir().endsWith(path.join("data", "journal-screenshots"))).toBe(true);
  });

  it("detects type from magic bytes and rejects spoofed MIME payloads", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageKind({ buffer: png })).toEqual({ contentType: "image/png", ext: "png" });
    expect(detectImageKind({ buffer: Buffer.from("not-an-image!!!!") })).toBeNull();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageKind({ buffer: jpeg })?.ext).toBe("jpg");
  });
});
