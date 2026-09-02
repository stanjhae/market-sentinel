import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_TTL_MS = 2 * 60 * 1000;

export type PreviewNoncePayload = {
  v: 1;
  exp: number;
  action: "open" | "close";
  planId?: string;
  positionId?: string;
  instrumentId: number;
  amount?: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
  requestId: string;
};

export function nonceSecret(args: { appPassword?: string; apiKey?: string; userKey?: string }): string {
  return args.appPassword || `${args.apiKey ?? ""}:${args.userKey ?? ""}:execution-nonce`;
}

export function signPreviewNonce(args: { secret: string; payload: PreviewNoncePayload }): string {
  const encoded = Buffer.from(JSON.stringify(args.payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", args.secret).update(encoded).digest("base64url");
  return `${encoded}.${mac}`;
}

export function verifyPreviewNonce(args: { secret: string; token: string; now: number }): PreviewNoncePayload | null {
  const separator = args.token.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const encoded = args.token.slice(0, separator);
  const mac = args.token.slice(separator + 1);
  const expected = createHmac("sha256", args.secret).update(encoded).digest("base64url");
  const providedMac = Buffer.from(mac);
  const expectedMac = Buffer.from(expected);
  if (providedMac.length !== expectedMac.length || !timingSafeEqual(providedMac, expectedMac)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewNoncePayload;
    if (payload.v !== 1 || typeof payload.exp !== "number" || payload.exp <= args.now) {
      return null;
    }
    if (payload.action !== "open" && payload.action !== "close") {
      return null;
    }
    if (!payload.requestId || typeof payload.instrumentId !== "number") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
