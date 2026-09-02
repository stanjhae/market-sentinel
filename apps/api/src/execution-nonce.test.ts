import { describe, expect, it } from "vitest";
import { PREVIEW_TTL_MS, signPreviewNonce, verifyPreviewNonce } from "./execution-nonce.js";

const secret = "correct-horse-battery";

describe("preview nonce", () => {
  it("round-trips a signed preview and rejects expiry or tampering", () => {
    const now = Date.parse("2026-09-02T12:00:00.000Z");
    const token = signPreviewNonce({
      secret,
      payload: {
        v: 1,
        exp: now + PREVIEW_TTL_MS,
        action: "open",
        planId: "plan-1",
        instrumentId: 27,
        amount: "50",
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(verifyPreviewNonce({ secret, token, now: now + 1_000 })?.planId).toBe("plan-1");
    expect(verifyPreviewNonce({ secret, token, now: now + PREVIEW_TTL_MS + 1 })).toBeNull();
    expect(verifyPreviewNonce({ secret, token: `${token}x`, now: now + 1_000 })).toBeNull();
  });
});
