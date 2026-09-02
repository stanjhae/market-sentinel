import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "sentinel_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const PUBLIC_PATHS = new Set(["/health/live", "/health/ready", "/auth/session", "/auth/login", "/auth/logout"]);

const loginAttempts = new Map<string, { failures: number; lockedUntil: number }>();

type SessionPayload = {
  v: 1;
  exp: number;
};

export function normalizeRequestPath(args: { url: string }): string {
  const raw = args.url.split("?")[0] ?? args.url;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const parts: string[] = [];
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

export function isPublicRoute(args: { url: string; method: string }): boolean {
  if (args.method === "OPTIONS") {
    return true;
  }
  return PUBLIC_PATHS.has(normalizeRequestPath({ url: args.url }));
}

export function allowedBrowserOrigins(args: { webPort: number }): string[] {
  return [`http://localhost:${args.webPort}`, `http://127.0.0.1:${args.webPort}`];
}

export function isAllowedBrowserOrigin(args: { origin: string | undefined; webPort: number }): boolean {
  if (!args.origin) {
    return false;
  }
  return allowedBrowserOrigins({ webPort: args.webPort }).includes(args.origin);
}

export function passwordsMatch(args: { provided: string; expected: string }): boolean {
  const provided = createHash("sha256").update(args.provided, "utf8").digest();
  const expected = createHash("sha256").update(args.expected, "utf8").digest();
  return timingSafeEqual(provided, expected);
}

export function signSession(args: { secret: string; now: number; ttlMs?: number }): string {
  const payload: SessionPayload = {
    v: 1,
    exp: args.now + (args.ttlMs ?? SESSION_TTL_MS),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", args.secret).update(encoded).digest("base64url");
  return `${encoded}.${mac}`;
}

export function verifySession(args: { token: string | undefined; secret: string; now: number }): boolean {
  if (!args.token) {
    return false;
  }
  const separator = args.token.lastIndexOf(".");
  if (separator <= 0) {
    return false;
  }
  const encoded = args.token.slice(0, separator);
  const mac = args.token.slice(separator + 1);
  const expected = createHmac("sha256", args.secret).update(encoded).digest("base64url");
  const providedDigest = createHash("sha256").update(mac, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  if (!timingSafeEqual(providedDigest, expectedDigest)) {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > args.now;
  } catch {
    return false;
  }
}

export function readSessionCookie(args: { header: string | undefined }): string | undefined {
  if (!args.header) {
    return undefined;
  }
  for (const part of args.header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return rest.join("=");
    }
  }
  return undefined;
}

export function sessionCookieHeader(args: { token: string; maxAgeSec: number; secure: boolean }): string {
  const flags = args.secure ? "HttpOnly; Path=/; SameSite=Lax; Secure" : "HttpOnly; Path=/; SameSite=Lax";
  return `${SESSION_COOKIE_NAME}=${args.token}; ${flags}; Max-Age=${args.maxAgeSec}`;
}

export function clearSessionCookieHeader(args: { secure: boolean }): string {
  return sessionCookieHeader({ token: "", maxAgeSec: 0, secure: args.secure });
}

export function requestIsHttps(args: { protocol?: string; forwardedProto?: string | string[] | undefined }): boolean {
  const forwarded = Array.isArray(args.forwardedProto) ? args.forwardedProto[0] : args.forwardedProto;
  return args.protocol === "https" || forwarded === "https";
}

export function loginLockStatus(args: { ip: string; now: number }): { locked: boolean; retryAfterSec: number } {
  const current = loginAttempts.get(args.ip);
  if (!current || args.now >= current.lockedUntil) {
    return { locked: false, retryAfterSec: 0 };
  }
  return { locked: true, retryAfterSec: Math.ceil((current.lockedUntil - args.now) / 1000) };
}

export function recordLoginFailure(args: { ip: string; now: number }): { locked: boolean; retryAfterSec: number } {
  const existing = loginAttempts.get(args.ip) ?? { failures: 0, lockedUntil: 0 };
  if (args.now < existing.lockedUntil) {
    return { locked: true, retryAfterSec: Math.ceil((existing.lockedUntil - args.now) / 1000) };
  }
  const failures = (args.now >= existing.lockedUntil ? existing.failures : 0) + 1;
  if (failures >= LOGIN_MAX_FAILURES) {
    loginAttempts.set(args.ip, { failures: 0, lockedUntil: args.now + LOGIN_LOCK_MS });
    return { locked: true, retryAfterSec: Math.ceil(LOGIN_LOCK_MS / 1000) };
  }
  loginAttempts.set(args.ip, { failures, lockedUntil: 0 });
  return { locked: false, retryAfterSec: 0 };
}

export function clearLoginFailures(args: { ip: string }): void {
  loginAttempts.delete(args.ip);
}

export function resetLoginAttemptsForTests(): void {
  loginAttempts.clear();
}
