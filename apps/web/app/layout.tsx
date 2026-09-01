import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Sentinel",
  description: "Personal market intelligence and trading discipline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-border px-6 py-4">
            <div className="flex items-baseline justify-between">
              <Link href="/">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Market Sentinel
                </p>
                <p className="text-lg font-semibold">Terminal</p>
              </Link>
              <nav className="flex gap-4 font-mono text-xs uppercase text-muted-foreground">
                <Link href="/" className="hover:text-foreground">
                  Dashboard
                </Link>
                <span>Signals</span>
                <span>Trade Gate</span>
                <span>Journal</span>
                <span>Analytics</span>
                <span>Settings</span>
              </nav>
            </div>
          </header>
          <main className="px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
