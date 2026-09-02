"use client";

import type { AlertDto, SettingsResponse, SseEvent } from "@market-sentinel/contracts";
import { API_BASE_URL } from "@/lib/api";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type StreamContextValue = {
  unreadCount: number;
  setUnreadCount: (args: { count: number }) => void;
  subscribe: (args: { onEvent: (event: SseEvent) => void }) => () => void;
};

const StreamContext = createContext<StreamContextValue | null>(null);

export function SentinelStreamProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCountState] = useState(0);
  const handlersRef = useRef(new Set<(event: SseEvent) => void>());
  const settingsRef = useRef<SettingsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshUnread(args: { notify?: AlertDto }) {
      try {
        const [alertsResponse, settingsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/alerts?unread=true`),
          fetch(`${API_BASE_URL}/settings`),
        ]);
        if (alertsResponse.ok) {
          const payload = (await alertsResponse.json()) as { unreadCount?: number };
          if (!cancelled && typeof payload.unreadCount === "number") {
            setUnreadCountState(payload.unreadCount);
          }
        }
        if (settingsResponse.ok) {
          const settings = (await settingsResponse.json()) as SettingsResponse;
          if (!cancelled) {
            settingsRef.current = settings;
          }
        }
        if (args.notify && !cancelled) {
          maybeNotify({ alert: args.notify, settings: settingsRef.current });
        }
      } catch {
        // badge and notifications stay at the last known server values
      }
    }

    void refreshUnread({});

    const source = new EventSource(`${API_BASE_URL}/stream`);
    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as SseEvent;
        if (parsed.type === "stream" && typeof parsed.payload.unreadCount === "number") {
          setUnreadCountState(parsed.payload.unreadCount);
        }
        if (parsed.type === "alert") {
          void refreshUnread({ notify: parsed.payload });
        }
        for (const handler of handlersRef.current) {
          handler(parsed);
        }
      } catch {
        // ignore malformed SSE frames
      }
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  const value = useMemo<StreamContextValue>(
    () => ({
      unreadCount,
      setUnreadCount: (args: { count: number }) => setUnreadCountState(args.count),
      subscribe: (args: { onEvent: (event: SseEvent) => void }) => {
        handlersRef.current.add(args.onEvent);
        return () => {
          handlersRef.current.delete(args.onEvent);
        };
      },
    }),
    [unreadCount],
  );

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useSentinelStream() {
  const context = useContext(StreamContext);
  if (!context) {
    throw new Error("useSentinelStream requires SentinelStreamProvider");
  }
  return context;
}

export function useSentinelEvents(args: { onEvent: (event: SseEvent) => void }) {
  const stream = useSentinelStream();
  useEffect(() => stream.subscribe({ onEvent: args.onEvent }), [stream, args.onEvent]);
}

export function maybeNotify(args: { alert: AlertDto; settings: SettingsResponse | null }) {
  if (typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  if (!args.settings?.alerts.enabled || !args.settings.alerts.browserEnabled) {
    return;
  }
  new Notification(args.alert.title, { body: args.alert.body });
}
