import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionCookieHeader,
  isAllowedBrowserOrigin,
  isPublicRoute,
  loginLockStatus,
  LOGIN_MAX_FAILURES,
  passwordsMatch,
  readSessionCookie,
  recordLoginFailure,
  requestIsHttps,
  resetLoginAttemptsForTests,
  SESSION_COOKIE_NAME,
  sessionCookieHeader,
  signSession,
  isTrustedProxyHop,
  trustProxySetting,
  verifySession,
} from "./auth.js";
import { buildServer } from "./server.js";

const password = "correct-horse-battery";

describe("session helpers", () => {
  it("treats only exact health and auth paths as public", () => {
    expect(isPublicRoute({ url: "/health/live", method: "GET" })).toBe(true);
    expect(isPublicRoute({ url: "/health/ready", method: "GET" })).toBe(true);
    expect(isPublicRoute({ url: "/auth/session", method: "GET" })).toBe(true);
    expect(isPublicRoute({ url: "/auth/login", method: "POST" })).toBe(true);
    expect(isPublicRoute({ url: "/auth/logout", method: "POST" })).toBe(true);
    expect(isPublicRoute({ url: "/settings/alerts", method: "OPTIONS" })).toBe(true);
    expect(isPublicRoute({ url: "/account", method: "GET" })).toBe(false);
    expect(isPublicRoute({ url: "/settings/risk", method: "PATCH" })).toBe(false);
    expect(isPublicRoute({ url: "/auth/../account", method: "GET" })).toBe(false);
    expect(isPublicRoute({ url: "/auth/extra", method: "GET" })).toBe(false);
  });

  it("round-trips a signed session and rejects expiry or tampering", () => {
    const now = Date.parse("2026-09-02T12:00:00.000Z");
    const token = signSession({ secret: password, now, ttlMs: 60_000 });
    expect(verifySession({ token, secret: password, now: now + 1_000 })).toBe(true);
    expect(verifySession({ token, secret: password, now: now + 120_000 })).toBe(false);
    expect(verifySession({ token: `${token}x`, secret: password, now: now + 1_000 })).toBe(false);
    expect(verifySession({ token, secret: "different-secret", now: now + 1_000 })).toBe(false);
    expect(verifySession({ token: undefined, secret: password, now })).toBe(false);
  });

  it("compares passwords without leaking the expected value", () => {
    expect(passwordsMatch({ provided: password, expected: password })).toBe(true);
    expect(passwordsMatch({ provided: "wrong-password-xx", expected: password })).toBe(false);
  });

  it("reads and clears the session cookie with Lax flags", () => {
    const token = signSession({ secret: password, now: 1 });
    expect(readSessionCookie({ header: `${SESSION_COOKIE_NAME}=${token}; other=1` })).toBe(token);
    expect(sessionCookieHeader({ token, maxAgeSec: 12, secure: false })).toContain("SameSite=Lax");
    expect(sessionCookieHeader({ token, maxAgeSec: 12, secure: false })).not.toContain("Secure");
    expect(sessionCookieHeader({ token, maxAgeSec: 12, secure: true })).toContain("Secure");
    expect(clearSessionCookieHeader({ secure: false })).toContain("Max-Age=0");
    expect(requestIsHttps({ protocol: "https" })).toBe(true);
    expect(requestIsHttps({ protocol: "http", forwardedProto: "https" })).toBe(true);
  });

  it("trusts a single proxy hop only in production", () => {
    expect(trustProxySetting({ nodeEnv: "development" })).toBe(false);
    expect(trustProxySetting({ nodeEnv: "test" })).toBe(false);
    expect(isTrustedProxyHop({ hop: 0 })).toBe(true);
    expect(isTrustedProxyHop({ hop: 1 })).toBe(false);
    expect(typeof trustProxySetting({ nodeEnv: "production" })).toBe("function");
  });

  it("allowlists only the local web origins", () => {
    expect(isAllowedBrowserOrigin({ origin: "http://localhost:3000", webPort: 3000 })).toBe(true);
    expect(isAllowedBrowserOrigin({ origin: "https://evil.example", webPort: 3000 })).toBe(false);
    expect(isAllowedBrowserOrigin({ origin: undefined, webPort: 3000 })).toBe(false);
  });
});

describe("login lockout", () => {
  afterEach(() => {
    resetLoginAttemptsForTests();
  });

  it("locks an IP after five failures", () => {
    const now = 1_000;
    for (let index = 0; index < LOGIN_MAX_FAILURES - 1; index += 1) {
      expect(recordLoginFailure({ ip: "1.1.1.1", now }).locked).toBe(false);
    }
    expect(recordLoginFailure({ ip: "1.1.1.1", now }).locked).toBe(true);
    expect(loginLockStatus({ ip: "1.1.1.1", now }).locked).toBe(true);
    expect(loginLockStatus({ ip: "2.2.2.2", now }).locked).toBe(false);
  });
});

describe("app password gate", () => {
  afterEach(() => {
    resetLoginAttemptsForTests();
  });

  it("leaves /account open when APP_PASSWORD is unset", async () => {
    const { app } = await buildServer();
    const response = await app.inject({ method: "GET", url: "/account" });
    expect(response.statusCode).not.toBe(401);
    await app.close();
  });

  it("rejects account, settings, and stream without a session when a password is set", async () => {
    const { app } = await buildServer({ env: { APP_PASSWORD: password } });
    const account = await app.inject({ method: "GET", url: "/account" });
    expect(account.statusCode).toBe(401);
    const settings = await app.inject({
      method: "PATCH",
      url: "/settings/risk",
      payload: { maxRiskPerTradePct: 1 },
    });
    expect(settings.statusCode).toBe(401);
    const stream = await app.inject({ method: "GET", url: "/stream" });
    expect(stream.statusCode).toBe(401);
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual(
      expect.objectContaining({
        ready: expect.any(Boolean),
        checks: expect.objectContaining({ database: expect.any(Boolean) }),
      }),
    );
    await app.close();
  });

  it("does not reflect a foreign Origin on credentialed CORS", async () => {
    const { app } = await buildServer();
    const foreign = await app.inject({
      method: "GET",
      url: "/account",
      headers: { origin: "https://evil.example" },
    });
    expect(foreign.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
    const local = await app.inject({
      method: "GET",
      url: "/account",
      headers: { origin: "http://localhost:3000" },
    });
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(local.headers["access-control-allow-credentials"]).toBe("true");
    await app.close();
  });

  it("rejects a wrong password without echoing it, accepts a valid login cookie, and logout clears it", async () => {
    const { app } = await buildServer({ env: { APP_PASSWORD: password } });
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password: "wrong-password-xx" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(JSON.stringify(wrong.json())).not.toContain("wrong-password");
    expect(JSON.stringify(wrong.json())).not.toContain(password);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain(SESSION_COOKIE_NAME);
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).not.toContain(password);
    const sessionPair = String(cookieHeader).split(";")[0];

    const account = await app.inject({
      method: "GET",
      url: "/account",
      headers: { cookie: sessionPair },
    });
    expect(account.statusCode).not.toBe(401);
    expect(cookieHeader).not.toContain("Secure");

    const httpsLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password },
      headers: { "x-forwarded-proto": "https" },
    });
    expect(String(httpsLogin.headers["set-cookie"])).toContain("Secure");

    const logout = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    await app.close();
  });

  it("locks login after five failures from the same client", async () => {
    const { app } = await buildServer({ env: { APP_PASSWORD: password } });
    for (let index = 0; index < LOGIN_MAX_FAILURES - 1; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { password: "wrong-password-xx" },
      });
      expect(response.statusCode).toBe(401);
    }
    const locked = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password: "wrong-password-xx" },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe("too-many-attempts");
    const stillLocked = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { password },
    });
    expect(stillLocked.statusCode).toBe(429);
    await app.close();
  });
});
