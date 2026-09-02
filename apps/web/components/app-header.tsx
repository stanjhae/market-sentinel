"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSentinelStream } from "./sentinel-stream";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/signals", label: "Signals" },
  { href: "/account", label: "Account" },
  { href: "/trade-gate", label: "Trade Gate" },
  { href: "/alerts", label: "Alerts" },
  { href: "/journal", label: "Journal" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const { unreadCount } = useSentinelStream();

  return (
    <header className="border-b border-border px-6 py-4">
      <div className="flex items-baseline justify-between">
        <Link href="/">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Market Sentinel</p>
          <p className="text-lg font-semibold">Terminal</p>
        </Link>
        <nav className="flex gap-4 font-mono text-xs uppercase text-muted-foreground">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn("hover:text-foreground", {
                "text-foreground": pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href)),
              })}
            >
              {link.label}
              {link.href === "/alerts" && unreadCount > 0 ? (
                <Badge className="ml-2" variant="live">
                  {unreadCount}
                </Badge>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
