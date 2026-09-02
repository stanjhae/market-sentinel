"use client";

import type { AuthSession } from "@market-sentinel/contracts";
import { apiFetch } from "@/lib/api";
import { sessionAfterCheckFailure } from "@/lib/session-fallback";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type AuthContextValue = {
  session: AuthSession | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch({ path: "/auth/session" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API ${response.status}`);
        }
        return (await response.json()) as AuthSession;
      })
      .then((payload) => {
        if (!cancelled) {
          setSession(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(sessionAfterCheckFailure());
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    if (session.required && !session.authenticated && pathname !== "/login") {
      router.replace("/login");
    }
    if (session.required && session.authenticated && pathname === "/login") {
      router.replace("/");
    }
  }, [pathname, router, session]);

  const value = useMemo<AuthContextValue>(() => ({ session }), [session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthSession requires AuthSessionProvider");
  }
  return context;
}
