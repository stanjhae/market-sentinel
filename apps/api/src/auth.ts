import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "sentinel_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const PUBLIC_PATHS = new Set(["/health/live", "/auth/session", "/auth/login", "/auth/logout"]);

const loginAttempts = new Map<string, { failures: number; lockedUntil: number }>();

export type LoginLockSnapshot = { failures: number; lockedUntil: number };

export type LoginLockStore = {
  get: (ip: string) => Promise<LoginLockSnapshot | undefined>;
  set: (args: { ip: string; value: LoginLockSnapshot; ttlMs: number }) => Promise<void>;
  del: (ip: string) => Promise<void>;
};

const memoryLoginLockStore: LoginLockStore = {
  get: async (ip) => loginAttempts.get(ip),
  set: async (args) => {
    loginAttempts.set(args.ip, args.value);
  },
  del: async (ip) => {
    loginAttempts.delete(ip);
  },
};

export function createRedisLoginLockStore(args: {
  redis: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, mode: "PX", ttlMs: number) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
  };
  keyFor: (ip: string) => string;
}): LoginLockStore {
  return {
    get: async (ip) => {
      try {
        const raw = await args.redis.get(args.keyFor(ip));
        if (!raw) {
          return memoryLoginLockStore.get(ip);
        }
        const parsed = JSON.parse(raw) as LoginLockSnapshot;
        if (typeof parsed.failures === "number" && typeof parsed.lockedUntil === "number") {
          return parsed;
        }
      } catch {
        return memoryLoginLockStore.get(ip);
      }
      return memoryLoginLockStore.get(ip);
    },
    set: async (entry) => {
      await memoryLoginLockStore.set(entry);
      try {
        await args.redis.set(args.keyFor(entry.ip), JSON.stringify(entry.value), "PX", Math.max(1, entry.ttlMs));
      } catch {
        // Memory remains the process-local fallback when Redis is down.
      }
    },
    del: async (ip) => {
      await memoryLoginLockStore.del(ip);
      try {
        await args.redis.del(args.keyFor(ip));
      } catch {
        // Ignore Redis delete failures after the local entry is cleared.
      }
    },
  };
}

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

export function isTrustedProxyHop(args: { hop: number }): boolean {
  return args.hop < 1;
}

export function trustProxySetting(args: {
  nodeEnv: "development" | "test" | "production";
}): false | ((address: string, hop: number) => boolean) {
  if (args.nodeEnv !== "production") {
    return false;
  }
  return (_address, hop) => isTrustedProxyHop({ hop });
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

export async function loginLockStatus(args: {
  ip: string;
  now: number;
  store?: LoginLockStore;
}): Promise<{ locked: boolean; retryAfterSec: number }> {
  const store = args.store ?? memoryLoginLockStore;
  const current = await store.get(args.ip);
  if (!current || args.now >= current.lockedUntil) {
    return { locked: false, retryAfterSec: 0 };
  }
  return { locked: true, retryAfterSec: Math.ceil((current.lockedUntil - args.now) / 1000) };
}

export async function recordLoginFailure(args: {
  ip: string;
  now: number;
  store?: LoginLockStore;
}): Promise<{ locked: boolean; retryAfterSec: number }> {
  const store = args.store ?? memoryLoginLockStore;
  const existing = (await store.get(args.ip)) ?? { failures: 0, lockedUntil: 0 };
  if (args.now < existing.lockedUntil) {
    return { locked: true, retryAfterSec: Math.ceil((existing.lockedUntil - args.now) / 1000) };
  }
  const failures = (args.now >= existing.lockedUntil ? existing.failures : 0) + 1;
  if (failures >= LOGIN_MAX_FAILURES) {
    const lockedUntil = args.now + LOGIN_LOCK_MS;
    await store.set({ ip: args.ip, value: { failures: 0, lockedUntil }, ttlMs: LOGIN_LOCK_MS });
    return { locked: true, retryAfterSec: Math.ceil(LOGIN_LOCK_MS / 1000) };
  }
  await store.set({ ip: args.ip, value: { failures, lockedUntil: 0 }, ttlMs: LOGIN_LOCK_MS });
  return { locked: false, retryAfterSec: 0 };
}

export async function clearLoginFailures(args: { ip: string; store?: LoginLockStore }): Promise<void> {
  await (args.store ?? memoryLoginLockStore).del(args.ip);
}

export function resetLoginAttemptsForTests(): void {
  loginAttempts.clear();
}
