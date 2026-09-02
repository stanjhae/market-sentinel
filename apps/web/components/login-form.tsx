"use client";

import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(args: { event: FormEvent<HTMLFormElement> }) {
    args.event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch({
        path: "/auth/login",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        },
      });
      if (response.status === 429) {
        setError("Too many attempts. Try again later.");
        return;
      }
      if (!response.ok) {
        setError("Invalid password");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Sign-in unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Market Sentinel</p>
      <h1 className="mt-2 text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">This private deployment requires the app password.</p>
      <form className="mt-4 space-y-3" onSubmit={(event) => void submit({ event })}>
        <label className="block font-mono text-xs uppercase text-muted-foreground">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={cn("mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground")}
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className={cn("rounded-md border border-border bg-card px-3 py-2 text-sm", {
            "opacity-50": submitting || password.length === 0,
          })}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Card>
  );
}
